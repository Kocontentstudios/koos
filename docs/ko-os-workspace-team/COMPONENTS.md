# Component Documentation
## KO OS Workspace & Team Feature

### Sidebar Navigation
- Fixed position, 240px width
- Contains: Brand logo, Nav items, Workspace Card
- Nav items have active indicator (3px blue bar on left)
- Active state: --sidebar-item-active background

### Workspace Card
- Replaces the previous user profile card at bottom of sidebar
- Displays: Workspace avatar (gradient), Name, Role (Owner/Member)
- Click to open Workspace Menu dropdown
- Chevron rotates 180deg when menu is open

### Workspace Menu
- Dropdown appears above the workspace card
- Sections separated by dividers:
  1. Current Workspace indicator
  2. Workspace Switcher (list of available workspaces)
  3. Actions (Manage Team, Workspace Settings)
  4. Account actions (My Account, Log Out)
- Active workspace highlighted with blue background
- Checkmark icon shown for active workspace

### Team Page - Empty State
- Centered illustration (gradient background, team icon)
- Headline: "Build Your Team"
- Description: "Invite someone you trust to manage your content operations."
- Primary CTA: "Invite Team" button

### Team Page - Populated State
- Tabs: "All Members" / "Pending"
- Member list items showing:
  - Avatar (colored initials)
  - Full Name
  - Email
  - Status badge (Owner/Member/Active/Pending)
  - Actions (Remove, Resend Invitation)

### Invite Team Modal
- Overlay with dark backdrop
- Title: "Invite Your Team"
- Subtitle explaining the feature
- Email input field with validation
- Error states: Invalid Email, Already Invited, Already Member
- Success state: Green alert banner
- Loading state: Spinner in button
- Actions: Cancel, Send Invitation

### Remove Member Confirmation
- Centered confirmation dialog
- Warning icon (red circle)
- Member name highlighted
- Description of consequences
- Actions: Cancel, Remove Member (danger style)

### Workspace Settings
- Sections with cards:
  - Workspace Information (name, logo)
  - Notifications (toggle switches)
  - Danger Zone (delete workspace)
- Toggle switches: 44px width, animated knob

### Dashboard - Invite Card
- Gradient background (blue to purple, low opacity)
- Team icon in blue circle
- Title: "Invite Your Team"
- Description text
- Actions: Invite Team (primary), Learn More (secondary)
- Hidden when team members exist

### Dashboard - Team Overview Card
- Shows member count and pending count
- Avatar stack (overlapping circles)
- "Manage Team" link
- Shown when team members exist
