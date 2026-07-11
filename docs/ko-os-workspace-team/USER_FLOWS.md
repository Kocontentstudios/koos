# User Flow Documentation
## KO OS Workspace & Team Feature

## Flow 1: Founder Invites First Team Member

```
[Dashboard]
    |
    v
[Click "Invite Your Team" card or Team nav]
    |
    v
[Team Page - Empty State]
    |
    v
[Click "Invite Team" button]
    |
    v
[Invite Modal opens]
    |
    v
[Enter email address]
    |
    v
[Click "Send Invitation"]
    |
    v
[Validation check]
    |-- Invalid --> [Show error, stay in modal]
    |-- Already invited --> [Show error, stay in modal]
    |-- Already member --> [Show error, stay in modal]
    |
    v
[Show loading spinner]
    |
    v
[Show success alert]
    |
    v
[Auto-close modal after 1.5s]
    |
    v
[Team Page - Populated State]
    |
    v
[Dashboard updates: Invite card -> Team Overview card]
    |
    v
[Toast: "Invitation sent to [email]"]
```

## Flow 2: Team Member Accepts Invitation

```
[Email received: "You've been invited to join a KO OS Workspace"]
    |
    v
[Click "Accept Invitation" button in email]
    |
    v
[Check: Has KO OS account?]
    |-- Yes --> [Sign In] --> [Workspace auto-attached] --> [Dashboard]
    |-- No --> [Create Account] --> [Verify email] --> [Workspace auto-attached] --> [Dashboard]
```

## Flow 3: Founder Switches Workspaces

```
[Any page]
    |
    v
[Click Workspace Card at bottom of sidebar]
    |
    v
[Workspace Menu opens]
    |
    v
[Click different workspace]
    |
    v
[Show switching overlay with spinner]
    |
    v
[Load new workspace data]
    |
    v
[Update all views with new workspace context]
    |
    v
[Toast: "Switched to [Workspace Name]"]
```

## Flow 4: Founder Removes Team Member

```
[Team Page - Populated State]
    |
    v
[Click "Remove" on member row]
    |
    v
[Confirmation Modal opens]
    |
    v
[Click "Remove Member" to confirm]
    |
    v
[Member removed from list]
    |
    v
[Access revoked immediately]
    |
    v
[Toast: "[Name] has been removed from the workspace"]
```

## Flow 5: Founder Resends Invitation

```
[Team Page - Populated State]
    |
    v
[Click "Resend" on pending member]
    |
    v
[New invitation email sent]
    |
    v
[Toast: "Invitation resent to [Name]"]
```

## Flow 6: Member Views Workspace Settings

```
[Click Workspace Card]
    |
    v
[Workspace Menu opens]
    |
    v
[Click "Workspace Settings"]
    |
    v
[Workspace Settings Page]
    |
    v
[Modify settings (name, logo, notifications)]
    |
    v
[Changes saved automatically]
```

## State Transitions

### Dashboard States
1. **No Team**: Shows "Invite Your Team" card
2. **With Team**: Shows "Team Overview" card with member count and avatars

### Team Page States
1. **Empty**: Shows illustration, headline, CTA
2. **Populated**: Shows member list with tabs (All/Pending)

### Invite Modal States
1. **Initial**: Clean form, focused input
2. **Loading**: Button shows spinner, disabled
3. **Success**: Green alert, auto-close
4. **Error**: Red alert with specific message
5. **Validation Error**: Red border on input, error text
