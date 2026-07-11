# KO OS Design System
## Workspace & Team Feature Extension

### Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| --sidebar-bg | #0A1628 | Sidebar background |
| --main-bg | #0D1B2A | Main content background |
| --card-bg | #111D32 | Card backgrounds |
| --card-bg-secondary | #0F1A2E | Secondary card backgrounds |
| --card-bg-tertiary | #162236 | Tertiary/hover states |
| --text-primary | #FFFFFF | Primary text |
| --text-secondary | #8B9DB8 | Secondary text |
| --text-muted | #5A6F8A | Muted/disabled text |
| --accent-blue | #3B82F6 | Primary action color |
| --accent-blue-hover | #2563EB | Primary action hover |
| --accent-green | #10B981 | Success states |
| --accent-purple | #8B5CF6 | Accent/purple elements |
| --accent-pink | #EC4899 | Pink accent |
| --accent-yellow | #F59E0B | Warning/pending states |
| --accent-orange | #F97316 | Orange accent |
| --border | #1E3A5F | Borders |
| --border-light | #1A2D4A | Light borders |
| --error-text | #EF4444 | Error text |
| --success-text | #10B981 | Success text |

### Typography

| Element | Size | Weight | Line Height | Color |
|---------|------|--------|-------------|-------|
| Page Title | 24px | 600 | 1.3 | text-primary |
| Page Subtitle | 14px | 400 | 1.5 | text-secondary |
| Card Title | 16px | 600 | 1.4 | text-primary |
| Body | 14px | 400 | 1.5 | text-primary |
| Caption | 12px | 400 | 1.4 | text-muted |
| Button | 14px | 500 | 1.4 | varies |
| Badge | 11px | 500 | 1 | varies |

### Spacing Scale

| Token | Value |
|-------|-------|
| --sidebar-width | 240px |
| --page-padding | 32px |
| --card-padding | 24px |
| --card-gap | 20px |
| --section-gap | 24px |
| --inner-gap | 16px |
| --element-gap | 12px |
| --small-gap | 8px |

### Border Radius

| Token | Value |
|-------|-------|
| --radius-card | 12px |
| --radius-button | 8px |
| --radius-input | 8px |
| --radius-badge | 6px |
| --radius-modal | 16px |
| --radius-menu | 8px |

### Shadows

| Token | Value |
|-------|-------|
| --shadow-card | 0 4px 24px rgba(0, 0, 0, 0.3) |
| --shadow-modal | 0 20px 60px rgba(0, 0, 0, 0.5) |
| --shadow-dropdown | 0 8px 32px rgba(0, 0, 0, 0.4) |

### Component Patterns

#### Cards
- Background: --card-bg
- Border: 1px solid --border-light
- Border Radius: --radius-card (12px)
- Padding: --card-padding (24px)
- Hover: border-color transitions to --border

#### Buttons
- Primary: --accent-blue background, white text
- Secondary: transparent background, --border border
- Ghost: transparent, no border
- Border Radius: --radius-button (8px)
- Padding: 10px 18px

#### Inputs
- Background: --input-bg
- Border: 1px solid --input-border
- Border Radius: --radius-input (8px)
- Focus: --accent-blue border + box-shadow glow

#### Badges
- Border Radius: --radius-badge (6px)
- Padding: 4px 10px
- Font Size: 11px

#### Modals
- Background: --card-bg
- Border Radius: --radius-modal (16px)
- Border: 1px solid --border
- Shadow: --shadow-modal
- Overlay: rgba(0, 0, 0, 0.7)
