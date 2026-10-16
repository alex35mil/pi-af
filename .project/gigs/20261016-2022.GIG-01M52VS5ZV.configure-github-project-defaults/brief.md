# Brief

Configure GitHub Project defaults during setup.

Extend GitHub project setup to configure the Project’s initial presentation and repository context:

- Rename the default Project view.
- Configure the view layout.
- Set the default repository used when creating Project items.

Support new, existing, and resumed Projects. Inspect current settings, present the exact proposed changes, require approval, apply only supported mutations, and verify provider state afterward.

Before implementation, verify the latest official GitHub API and MCP capabilities for renaming views, changing an existing view’s layout, and setting a default repository. When GitHub exposes a setting only through its UI, provide a precise guided setup step rather than using an undocumented endpoint.

Read the current GitHub Project configuration for this repository and encode it as defaults.
