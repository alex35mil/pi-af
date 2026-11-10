import PitonKit
import SwiftUI

#if canImport(UIKit)
    import UIKit
    typealias PlatformImage = UIImage
#else
    import AppKit
    typealias PlatformImage = NSImage
#endif

/// One image's data in the app. Not started yet is a missing entry.
enum ImageLoad {
    case loading
    case loaded(PlatformImage)
    case failed
}

extension PlatformImage {
    /// The image's size in pixels.
    var pixelSize: CGSize {
        #if canImport(UIKit)
            CGSize(width: size.width * scale, height: size.height * scale)
        #else
            // The largest bitmap; the point size when there's no bitmap.
            representations.map { CGSize(width: $0.pixelsWide, height: $0.pixelsHigh) }
                .max { $0.width * $0.height < $1.width * $1.height } ?? size
        #endif
    }
}

extension Image {
    init(platformImage: PlatformImage) {
        #if canImport(UIKit)
            self.init(uiImage: platformImage)
        #else
            self.init(nsImage: platformImage)
        #endif
    }
}

/// A session's images as the open conversation has them. The daemon sends references only; each image is fetched and
/// decoded once, when its thumbnail first comes into view, so a session full of screenshots opens as fast as one
/// without, and scrolling back doesn't fetch again. One per open conversation (SessionView owns it), released with it.
/// The viewer shows the same loaded images.
@MainActor @Observable final class ImageLibrary {
    @ObservationIgnored let store: Store
    @ObservationIgnored let session: SessionKey
    private(set) var loads: [ImageID: ImageLoad] = [:]

    init(store: Store, session: SessionKey) {
        self.store = store
        self.session = session
    }

    /// Fetches `ref` unless it's loading or loaded; `again` retries a failed one.
    func fetch(_ ref: ImageRef, again: Bool = false) async {
        switch (loads[ref.id], again) {
        case (nil, _), (.failed?, true): break
        case (.loading?, _), (.loaded?, _), (.failed?, false): return
        }
        loads[ref.id] = .loading
        guard let data = await store.image(session, id: ref.id)?.bytes, let image = PlatformImage(data: data) else {
            loads[ref.id] = .failed
            return
        }
        loads[ref.id] = .loaded(image)
    }
}

/// A message's images open in the viewer, at `index`.
@MainActor @Observable final class ImageGallery {
    let refs: [ImageRef]
    let library: ImageLibrary
    var index: Int

    init(refs: [ImageRef], library: ImageLibrary, start: Int) {
        self.refs = refs
        self.library = library
        index = min(max(start, 0), max(refs.count - 1, 0))
    }

    var current: ImageRef? { refs.indices.contains(index) ? refs[index] : nil }

    /// "2 / 3", when there's more than one.
    var counter: String? { refs.count > 1 ? "\(index + 1) / \(refs.count)" : nil }

    /// Moves by `offset`, stopping at the first and last image.
    func step(_ offset: Int) {
        let next = index + offset
        guard refs.indices.contains(next) else { return }
        index = next
    }
}

/// The open image viewer, if any. The same viewer on both platforms: the images over a dimmed backdrop, a counter and a
/// close button on top. On the phone it covers the app (see RootView); on the Mac, the whole screen, in a borderless
/// window over everything, so stepping between images swaps the image in place instead of resizing a window.
@MainActor @Observable final class ImageViewerModel {
    private(set) var gallery: ImageGallery?
    #if os(macOS)
        @ObservationIgnored private var overlay: ImageOverlayWindow?
        @ObservationIgnored private var keyMonitor: Any?
    #endif

    func open(_ gallery: ImageGallery) {
        #if os(macOS)
            removeOverlay(animated: false)
            self.gallery = gallery
            presentOverlay(gallery)
        #else
            self.gallery = gallery
        #endif
    }

    func close() {
        gallery = nil
        #if os(macOS)
            removeOverlay(animated: true)
        #endif
    }

    #if os(macOS)
        private func presentOverlay(_ gallery: ImageGallery) {
            guard let screen = NSApp.keyWindow?.screen ?? NSScreen.main else { return }
            let frame = screen.frame
            let visible = screen.visibleFrame
            // The visible area (without the menu bar and the Dock) in the overlay's top-left coordinates.
            let area = CGRect(
                x: visible.minX - frame.minX, y: frame.maxY - visible.maxY, width: visible.width,
                height: visible.height)
            let window = ImageOverlayWindow(
                contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            window.isOpaque = false
            window.backgroundColor = .clear
            window.hasShadow = false
            // Over the menu bar and the Dock too: the overlay is the whole screen.
            window.level = .statusBar
            window.collectionBehavior = [.fullScreenAuxiliary, .moveToActiveSpace]
            window.contentView = NSHostingView(
                rootView: ImageOverlay(gallery: gallery, area: area, scale: screen.backingScaleFactor) { [weak self] in
                    self?.close()
                }
                .pitonTheme())
            window.setFrame(frame, display: false)
            window.alphaValue = 0
            window.makeKeyAndOrderFront(nil)
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.15
                window.animator().alphaValue = 1
            }
            overlay = window
            // Esc, ← and → while the overlay is key, without anything in it needing focus.
            keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
                let target = event.window
                let code = event.keyCode
                let handled = MainActor.assumeIsolated { self?.handleKey(code, in: target) ?? false }
                return handled ? nil : event
            }
        }

        private func handleKey(_ code: UInt16, in window: NSWindow?) -> Bool {
            guard let overlay, window === overlay, let gallery else { return false }
            switch code {
            case 53: close()  // Esc
            case 123: gallery.step(-1)  // ←
            case 124: gallery.step(1)  // →
            default: return false
            }
            return true
        }

        private func removeOverlay(animated: Bool) {
            if let keyMonitor {
                NSEvent.removeMonitor(keyMonitor)
                self.keyMonitor = nil
            }
            guard let window = overlay else { return }
            overlay = nil
            guard animated else {
                window.orderOut(nil)
                return
            }
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.15
                window.animator().alphaValue = 0
            } completionHandler: {
                MainActor.assumeIsolated { window.orderOut(nil) }
            }
        }
    #endif
}

/// A message's images, under a count.
struct ImageStrip: View {
    let refs: [ImageRef]
    let library: ImageLibrary
    @Environment(ImageViewerModel.self) private var viewer: ImageViewerModel?
    @Environment(\.typography) private var typography

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(refs.count == 1 ? "1 image" : "\(refs.count) images", systemImage: "photo.on.rectangle.angled")
                .font(typography.data(.caption))
                .foregroundStyle(Theme.dim)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(refs.enumerated()), id: \.element.id) { index, ref in
                        ImageThumbnail(load: library.loads[ref.id])
                            .onTapGesture { tap(ref, at: index) }
                            .task(id: ref.id) { await library.fetch(ref) }
                    }
                }
            }
        }
        // Apart from the text above it.
        .padding(.top, 8)
    }

    private func tap(_ ref: ImageRef, at index: Int) {
        switch library.loads[ref.id] {
        case .loaded?:
            viewer?.open(ImageGallery(refs: refs, library: library, start: index))
        case .failed?:
            Task { await library.fetch(ref, again: true) }
        case .loading?, nil:
            break
        }
    }
}

struct ImageThumbnail: View {
    let load: ImageLoad?

    var body: some View {
        content
            .frame(width: 160, height: 120)
            .background(Theme.canvas)
            .overlay(Rectangle().stroke(Theme.hairline, lineWidth: 1))
            // Only the thumbnail's frame takes taps. A filled image overflows the frame, and clipping hides the
            // overflow without shrinking its hit area: a wide screenshot's took the taps for the whole strip.
            .contentShape(Rectangle())
            .accessibilityLabel("Image")
            .accessibilityAddTraits(.isButton)
    }

    @ViewBuilder private var content: some View {
        switch load {
        case .loading?, nil:
            ProgressView().controlSize(.small)
        case .loaded(let image)?:
            Image(platformImage: image).resizable().scaledToFill()
                .frame(width: 160, height: 120)
                .clipped()
                .contentShape(Rectangle())
        case .failed?:
            Label("Image unavailable", systemImage: "photo")
                .font(.caption)
                .foregroundStyle(Theme.dim)
        }
    }
}

/// The viewer's controls: the position among the message's images, and the close button.
struct ImageViewerBar: View {
    let counter: String?
    let close: () -> Void

    var body: some View {
        HStack {
            if let counter {
                Text(counter)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(Theme.secondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Theme.canvas.opacity(0.7), in: Capsule())
            }
            Spacer()
            Button("Close", systemImage: "xmark", action: close)
                .buttonStyle(IconButtonStyle())
        }
        .padding()
    }
}

/// An image that isn't shown yet: loading, or failed with a retry.
struct ImagePlaceholder: View {
    let failed: Bool
    let retry: () -> Void

    var body: some View {
        if failed {
            Button("Retry", systemImage: "arrow.clockwise", action: retry)
                .buttonStyle(OutlineButtonStyle())
        } else {
            ProgressView()
        }
    }
}

#if os(macOS)
    /// The borderless window the Mac's viewer covers the screen with. It takes key status, for Esc and the arrows.
    final class ImageOverlayWindow: NSWindow {
        override var canBecomeKey: Bool { true }
        override var canBecomeMain: Bool { false }
    }

    /// The Mac's viewer: the current image over a dimmed screen, at its natural size or 80% of the visible area when
    /// it's larger; centered across, a little above center vertically (ImageFit.verticalAnchor). ← and → step, Esc,
    /// the close button, or a click outside the image closes.
    struct ImageOverlay: View {
        let gallery: ImageGallery
        /// The screen's visible area (without the menu bar and the Dock), in the overlay's coordinates.
        let area: CGRect
        let scale: CGFloat
        let close: () -> Void

        var body: some View {
            let size = imageSize
            let top =
                max(0, area.height - size.height)
                * ImageFit.verticalAnchor(height: size.height, available: area.height)
            ZStack(alignment: .topLeading) {
                Color.black.opacity(0.8)
                    .contentShape(Rectangle())
                    .onTapGesture(perform: close)
                image
                    .frame(width: size.width, height: size.height)
                    .position(x: area.midX, y: area.minY + top + size.height / 2)
                if gallery.refs.count > 1 {
                    // At the screen's edges, level with the image's center; dimmed at the first and last image.
                    let y = area.minY + top + size.height / 2
                    Button("Previous", systemImage: "chevron.left") { gallery.step(-1) }
                        .buttonStyle(IconButtonStyle())
                        .disabled(gallery.index == 0)
                        .position(x: area.minX + 44, y: y)
                    Button("Next", systemImage: "chevron.right") { gallery.step(1) }
                        .buttonStyle(IconButtonStyle())
                        .disabled(gallery.index == gallery.refs.count - 1)
                        .position(x: area.maxX - 44, y: y)
                }
                ImageViewerBar(counter: gallery.counter, close: close)
                    .frame(width: area.width)
                    .fixedSize(horizontal: false, vertical: true)
                    .position(x: area.midX, y: area.minY + 32)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .ignoresSafeArea()
            .task(id: gallery.index) {
                if let ref = gallery.current { await gallery.library.fetch(ref) }
            }
        }

        private var load: ImageLoad? {
            gallery.current.flatMap { gallery.library.loads[$0.id] }
        }

        @ViewBuilder private var image: some View {
            switch load {
            case .loaded(let image)?:
                Image(nsImage: image).resizable().interpolation(.high).scaledToFit()
            case .failed?:
                ImagePlaceholder(failed: true) { retry() }
            case .loading?, nil:
                ImagePlaceholder(failed: false) {}
            }
        }

        private func retry() {
            guard let ref = gallery.current else { return }
            Task { await gallery.library.fetch(ref, again: true) }
        }

        private var imageSize: CGSize {
            switch load {
            case .loaded(let image)?:
                let bounds = CGSize(
                    width: area.width * ImageFit.screenShare, height: area.height * ImageFit.screenShare)
                return ImageFit.size(pixels: image.pixelSize, scale: scale, within: bounds)
            case .loading?, .failed?, nil:
                return CGSize(width: 160, height: 120)
            }
        }
    }
#endif

#if os(iOS)
    /// The phone's viewer: a message's images over the whole app, one page each, each at its natural size or fitted
    /// to the screen. Swipe across to page, pinch or double-tap to zoom, tap to hide or show the controls. Swiping
    /// down works as in Photos: the image follows the finger and shrinks a little while the backdrop and the controls
    /// fade in place; released far or fast enough, they vanish where they are and the image carries on off the bottom.
    struct ImageViewer: View {
        @Bindable var gallery: ImageGallery
        let close: () -> Void
        @State private var controls = true
        /// How far a swipe down has gone toward closing: 0 at rest, 1 at half the screen.
        @State private var dismissal: CGFloat = 0

        var body: some View {
            ZStack(alignment: .top) {
                Theme.canvas.opacity(1 - dismissal).ignoresSafeArea()
                TabView(selection: $gallery.index) {
                    ForEach(gallery.refs.indices, id: \.self) { i in
                        page(gallery.refs[i]).tag(i)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .background(Color.clear)
                .ignoresSafeArea()
                ImageViewerBar(counter: gallery.counter, close: close)
                    .opacity(controls ? 1 - dismissal : 0)
                    .allowsHitTesting(controls && dismissal == 0)
                    .animation(.easeInOut(duration: 0.2), value: controls)
            }
            .statusBarHidden(!controls || dismissal > 0)
            .persistentSystemOverlays(controls && dismissal == 0 ? .automatic : .hidden)
        }

        @ViewBuilder private func page(_ ref: ImageRef) -> some View {
            switch gallery.library.loads[ref.id] {
            case .loaded(let image)?:
                ZoomableImage(
                    image: image,
                    onTap: { controls.toggle() },
                    onDismissProgress: { progress, animated in
                        if animated {
                            withAnimation(.easeOut(duration: 0.25)) { dismissal = progress }
                        } else {
                            dismissal = progress
                        }
                    },
                    onDismiss: close
                )
                .ignoresSafeArea()
            case .failed?:
                ImagePlaceholder(failed: true) { Task { await gallery.library.fetch(ref, again: true) } }
            case .loading?, nil:
                ImagePlaceholder(failed: false) {}
                    .task { await gallery.library.fetch(ref) }
            }
        }
    }

    struct ZoomableImage: UIViewRepresentable {
        let image: UIImage
        let onTap: () -> Void
        /// How far a swipe down has gone (0 to 1), and whether to animate to it.
        let onDismissProgress: (CGFloat, Bool) -> Void
        let onDismiss: () -> Void

        func makeUIView(context: Context) -> DraggableImageContainer {
            let view = DraggableImageContainer(image: image)
            updateUIView(view, context: context)
            return view
        }

        func updateUIView(_ view: DraggableImageContainer, context: Context) {
            view.zooming.onTap = onTap
            view.zooming.onDismissProgress = onDismissProgress
            view.zooming.onDismiss = onDismiss
        }
    }

    /// Holds the zooming view so the drag to close can move it. SwiftUI owns the frame of the view it hosts and sets it
    /// again on every update (each step of the backdrop's fade), which undid a transform on that view: the image stood
    /// still while the backdrop faded, then dropped in from the top. The zooming view is this container's subview, laid
    /// out with bounds and center, so its transform survives.
    final class DraggableImageContainer: UIView {
        let zooming: ZoomingImageView

        init(image: UIImage) {
            zooming = ZoomingImageView(image: image)
            super.init(frame: .zero)
            backgroundColor = .clear
            addSubview(zooming)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("not used from a storyboard") }

        override func layoutSubviews() {
            super.layoutSubviews()
            // Size only: a scroll view's bounds origin is its scroll position.
            if zooming.bounds.size != bounds.size {
                zooming.bounds.size = bounds.size
            }
            zooming.center = CGPoint(x: bounds.midX, y: bounds.midY)
        }
    }

    /// A scroll view that zooms its image: starts at the image's natural size (pixels over the screen's scale), or
    /// fitted when that's larger than the screen, and keeps it centered while it's smaller than the screen. At the
    /// fitted size, a drag down moves the image with the finger and closes the viewer when it goes far or fast enough.
    /// The scroll view is transparent, so moving it moves only the image.
    final class ZoomingImageView: UIScrollView, UIScrollViewDelegate {
        var onTap: () -> Void = {}
        var onDismissProgress: (CGFloat, Bool) -> Void = { _, _ in }
        var onDismiss: () -> Void = {}

        /// The smallest the image gets while dragged down, at the end of the drag's range.
        private static let draggedScale: CGFloat = 0.75

        private let imageView: UIImageView
        private var laidOutFor: CGSize = .zero
        private let dismissPan = UIPanGestureRecognizer()

        init(image: UIImage) {
            imageView = UIImageView(image: image)
            super.init(frame: .zero)
            delegate = self
            backgroundColor = .clear
            showsHorizontalScrollIndicator = false
            showsVerticalScrollIndicator = false
            contentInsetAdjustmentBehavior = .never
            decelerationRate = .fast
            addSubview(imageView)
            let doubleTap = UITapGestureRecognizer(target: self, action: #selector(toggleZoom(_:)))
            doubleTap.numberOfTapsRequired = 2
            addGestureRecognizer(doubleTap)
            let tap = UITapGestureRecognizer(target: self, action: #selector(tapped))
            tap.require(toFail: doubleTap)
            addGestureRecognizer(tap)
            dismissPan.addTarget(self, action: #selector(dragged(_:)))
            addGestureRecognizer(dismissPan)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("not used from a storyboard") }

        override func layoutSubviews() {
            super.layoutSubviews()
            // Fit again only when the screen's size changes (rotation), not on every pan.
            if bounds.size != laidOutFor, bounds.width > 0, bounds.height > 0 {
                laidOutFor = bounds.size
                fit()
            }
            center()
        }

        /// The drag to close starts only for a downward drag at the fitted size; zoomed in, a drag pans the image, and
        /// a sideways one pages.
        override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard gestureRecognizer === dismissPan else { return super.gestureRecognizerShouldBegin(gestureRecognizer) }
            guard zoomScale <= minimumZoomScale + 0.01 else { return false }
            let velocity = dismissPan.velocity(in: self)
            return velocity.y > abs(velocity.x)
        }

        private func fit() {
            guard let image = imageView.image else { return }
            let pixels = image.pixelSize
            let scale = traitCollection.displayScale
            let natural = CGSize(width: pixels.width / scale, height: pixels.height / scale)
            let fitted = ImageFit.size(pixels: pixels, scale: scale, within: bounds.size)
            guard natural.width > 0 else { return }
            zoomScale = 1
            imageView.frame = CGRect(origin: .zero, size: natural)
            contentSize = natural
            minimumZoomScale = fitted.width / natural.width
            maximumZoomScale = max(4, minimumZoomScale * 4)
            zoomScale = minimumZoomScale
        }

        /// Insets that center the image while it's smaller than the screen.
        private func center() {
            let x = max(0, (bounds.width - contentSize.width) / 2)
            let y = max(0, (bounds.height - contentSize.height) / 2)
            contentInset = UIEdgeInsets(top: y, left: x, bottom: y, right: x)
        }

        @objc private func tapped() { onTap() }

        @objc private func dragged(_ pan: UIPanGestureRecognizer) {
            let translation = pan.translation(in: self)
            switch pan.state {
            case .began, .changed:
                let progress = min(1, max(0, translation.y) / (bounds.height / 2))
                // The scroll view itself moves: the image view's transform belongs to zooming.
                transform = Self.dragTransform(translation, progress: progress)
                onDismissProgress(progress, false)
            case .ended:
                let velocity = pan.velocity(in: self).y
                if translation.y > 120 || velocity > 900 {
                    finishDismissal(from: translation, velocity: velocity)
                } else {
                    settle()
                }
            case .cancelled, .failed:
                settle()
            case .possible:
                break
            @unknown default:
                settle()
            }
        }

        /// Follows the finger, shrinking toward `draggedScale` as the drag goes on.
        private static func dragTransform(_ translation: CGPoint, progress: CGFloat) -> CGAffineTransform {
            let scale = 1 - (1 - draggedScale) * progress
            return CGAffineTransform(translationX: translation.x, y: translation.y).scaledBy(x: scale, y: scale)
        }

        /// Released past the threshold: everything around the image vanishes where it is, and the image keeps going
        /// down, at least as fast as the finger left it, until it's off the screen. Then the viewer closes.
        private func finishDismissal(from translation: CGPoint, velocity: CGFloat) {
            isUserInteractionEnabled = false
            onDismissProgress(1, true)
            let progress = min(1, max(0, translation.y) / (bounds.height / 2))
            let scale = 1 - (1 - Self.draggedScale) * progress
            let distance = bounds.height
            let duration = min(0.3, max(0.15, Double(distance / max(velocity, 1)) * 0.5))
            UIView.animate(withDuration: duration, delay: 0, options: [.curveEaseIn]) {
                self.transform = CGAffineTransform(translationX: translation.x, y: translation.y + distance)
                    .scaledBy(x: scale, y: scale)
            } completion: { _ in
                self.onDismiss()
            }
        }

        private func settle() {
            UIView.animate(
                withDuration: 0.3, delay: 0, usingSpringWithDamping: 0.85, initialSpringVelocity: 0
            ) {
                self.transform = .identity
            }
            onDismissProgress(0, true)
        }

        @objc private func toggleZoom(_ tap: UITapGestureRecognizer) {
            guard zoomScale <= minimumZoomScale + 0.01 else {
                setZoomScale(minimumZoomScale, animated: true)
                return
            }
            let scale = min(maximumZoomScale, max(1, minimumZoomScale * 2.5))
            let point = tap.location(in: imageView)
            let size = CGSize(width: bounds.width / scale, height: bounds.height / scale)
            zoom(
                to: CGRect(
                    x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height),
                animated: true)
        }

        func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }
        func scrollViewDidZoom(_ scrollView: UIScrollView) { center() }
    }
#endif
