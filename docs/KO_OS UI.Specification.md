

**KO OS**

Complete UI & User Experience

Strategy, Content Calendar, and Design Tickets

Screen-by-screen design, component specs, interactions, and tokens

Version 1.1  |  June 2026

**Table of Contents**

Right-click and select Update Field to refresh page numbers after editing.

**What KO OS Does (MVP Scope)	3**

**What the AI Creates (Strategy \+ Calendar)	4**

**MVP Principles	5**

**MVP vs Future Features	6**

**Detailed User Journey	7**

**Information Architecture	10**

**Navigation Model	11**

**Screen-by-Screen UI Specification	13**

Entry Page (Start Creating \+ Login)	13

Auth Screens (Login / Create Account)	16

App Shell (Top Bar \+ Sidebar \+ Content)	17

Create Brand (Required First Step)	19

Strategy Workspace (AI Chat)	23

Content Calendar View	29

Calendar Item Detail	35

Design Request (Ticket to Human Designers)	37

Privacy Policy	41

**KO OS Design System (Dark Mode)	42**

Token Set	42

Typography	44

Spacing Scale	45

Motion Language	45

**Component-by-Component Specs	46**

Buttons	46

Inputs	48

Cards	49

Chips and Tags	50

Calendar Components	51

Modals and Drawers	52

Toasts and Banners	53

**Responsiveness Specification	54**

**Accessibility Requirements	56**

# **1\. What KO OS Does (MVP Scope)**

KO OS is KO's internal operating system turned into a product. In this MVP, it is a guided workspace where AI helps businesses create content strategies and content calendars. The AI does NOT  YET create designs, videos, or any visual assets in the MVP. It creates the plan,  the strategy and the day-by-day calendar of what to post, where to post it, and when.

When the calendar identifies that a design asset is needed (for example, an Instagram carousel or a blog header image), the user can request that design through the app. This request — called a Design Ticket — is sent to KO's human design team. A real human designer receives the ticket, creates the asset using the brand information stored in the user's Brand Profile, and delivers it back through the platform.

## **1.1 The Three Core Functions of MVP**

### **Function 1: Brand Profile**

Before any strategy can be created, the user must set up their Brand Profile. This stores everything KO needs to know about the business: name, what they do, who they serve, their tone of voice, their logo, and their brand colors. This profile is used by the AI to generate relevant strategies and by the human design team to create on-brand assets.

### **Function 2: Content Strategy (AI-Powered)**

The user opens the Strategy workspace and chats with the AI. They describe what they want to achieve — for example: I am launching a new skincare product next month. The AI asks clarifying questions: What is your target age group? Which platforms are you currently on? What is your budget range? Do you have existing content? Based on the answers, the AI generates a comprehensive content strategy.

The strategy includes:

* Campaign overview — the big idea and core messaging.

* Channel recommendations — Instagram, LinkedIn, X, blog, email, TikTok, etc.

* Content type mix — carousels, Reels, stories, blog posts, email newsletters, static posts, write-ups.

* Posting frequency per channel.

* Key dates — launch day, pre-launch teaser period, post-launch follow-up.

* Content themes — weekly or phase-based themes that tie the campaign together.

### **Function 3: Content Calendar (AI-Generated)**

Once the strategy is approved, the AI converts it into a detailed day-by-day content calendar. The calendar shows exactly what needs to happen on each day:

* Day 1 (Monday, June 16): Post teaser image on Instagram at 9:00 AM. Caption: Something fresh is coming... Design needed: 1x 1080x1080 teaser graphic.

* Day 2 (Tuesday, June 17): Publish blog post Product Behind the Scenes at 10:00 AM. Write 800 words. Include 3 product photos.

* Day 3 (Wednesday, June 18): Post carousel on Instagram at 2:00 PM. Topic: 5 Ingredients That Make Our Product Different. Design needed: 1x carousel (5 slides).

* Day 4 (Thursday, June 19): Send email blast to subscriber list at 11:00 AM. Subject: Early access just dropped. Write 300 words.

* Each calendar item includes: date, time to post, platform, content type, caption/brief, and whether a design asset is required.

### **Design Tickets (Human Designer Workflow)**

When a calendar item requires a design, the user clicks the Request Design button on that item. This opens a Design Request form where the user can:

* Review the auto-filled brief (pulled from the calendar item).

* Select the design type (Instagram post, carousel, story, X graphic, banner, blog header, etc.).

* Add any specific notes or reference images.

* Confirm the request.

The request is then sent to KO's human design team as a Design Ticket. The ticket includes: the brand profile (logo, colors, fonts), the design brief, the content context, any notes from the user, and the due date. A human designer picks up the ticket, creates the asset, uploads it to the platform, and the user receives a notification that their design is ready.

# **2\. What the AI Creates (Strategy \+ Calendar)**

## **2.1 Strategy Output Format**

When the AI completes a strategy session, it presents the output in a structured, readable format within the chat interface. The strategy is broken into clear sections:

| Section | Description | Example |
| :---- | :---- | :---- |
| Campaign Name | A catchy, on-brand name for the campaign | The Fresh Drop |
| Campaign Objective | What this campaign aims to achieve | Drive 500 pre-orders in 14 days |
| Target Audience | Who the content is speaking to | Women 25-40, skincare enthusiasts, urban |
| Key Message | The single idea that ties all content together | Clean beauty without compromise |
| Channels | Recommended platforms with rationale | Instagram (primary), Email (conversion), Blog (SEO) |
| Content Mix | Types of content and how many of each | 8 carousel posts, 4 Reels, 3 stories, 2 emails, 1 blog |
| Timeline | Phases of the campaign with dates | Teaser (Days 1-3), Launch (Days 4-7), Sustain (Days 8-14) |
| Content Themes | Weekly or phase-based themes | Week 1: Behind the Scenes, Week 2: User Proof |
| Posting Schedule | Optimal days and times per channel | Instagram: Tue/Thu 9am, Email: Wed 11am |

## **2.2 Calendar Output Format**

The calendar converts the strategy into actionable daily items. Each calendar item contains:

| Field | Type | Example |
| :---- | :---- | :---- |
| Date | Calendar date | Monday, June 16, 2026 |
| Time | Posting time | 9:00 AM |
| Platform | Channel | Instagram |
| Content Type | Format | Carousel (5 slides) |
| Title | Short descriptor | 5 Ingredients That Make Us Different |
| Caption/Brief | Text content or writing prompt | Slide 1: Hook. Slide 2-5: One ingredient each... |
| Design Required | Yes/No \+ type | Yes — Instagram Carousel (5 slides) |
| Status | Draft / In Progress / Ready / Published | Draft |
| Design Ticket | Link to request or ticket ID | Request Design (opens form) |

## **2.3 Calendar Views**

The calendar supports multiple view modes to suit different workflows:

* Month View — Grid showing all days of the month. Each day cell shows small dots or mini-cards representing items. Tapping a day opens the detailed list for that day.

* Week View — Seven columns (Mon-Sun), each showing the day's items as stacked cards. Best for planning and reviewing the week ahead.

* Day View (List) — Single day shown as a vertical timeline. Each item is a full card with all details visible. This is the most detailed view.

* Agenda View — Compact list of all upcoming items across all days, sorted by date. Best for seeing what needs action next.

# **3\. MVP Principles**

## **3.1 Strategy First, Calendar Second**

The user must always go through the strategy step before seeing a calendar. The strategy is the foundation — it ensures the calendar makes sense. The AI should not generate a calendar without first understanding the user's goals, audience, and constraints through the strategy conversation.

## **3.2 AI Plans, Humans Design**

This is the most important principle for MVP. The AI creates the strategy and the calendar. It tells the user what to post, when to post it, and what the content should say. But when a visual asset is needed, the AI marks it as Design Required and the user must request it through a Design Ticket. The Design Ticket goes to a human designer at KO. No AI-generated images, videos, or designs in MVP.

## **3.3 Brand Profile is Required Before Strategy**

The AI cannot create a meaningful strategy without knowing the brand. After login, the user must complete their Brand Profile before they can access the Strategy workspace. The Brand Profile is the single source of truth for: business name, what they do, target audience, tone of voice, brand colors, and logo.

## **3.4 Every Calendar Item Must Be Actionable**

A calendar item is not vague. It does not say Post something on Instagram. It says: Post a 5-slide carousel on Instagram at 9:00 AM with the title 5 Ingredients That Make Us Different. Caption hook: Did you know the average skincare product has 25 ingredients? We use 5\. Here is why each one matters. Design needed: 5 slides (1080x1080 each).

## **3.5 Design Tickets Are Clear Briefs**

When a user requests a design, the form must auto-populate with everything the designer needs: the content brief, the brand colors, the logo, the platform specs (dimensions), and any user notes. The designer should never have to guess what the user wants.

## **3.6 AI Must Not Silently Fail**

When AI credits or API access is exhausted, the UI must show a clear error state with a message and a Try again button. Infinite loading spinners are unacceptable.

## **3.7 Privacy Policy Must Exist**

A Privacy Policy link must be accessible from the entry page footer and from the profile menu.

# **4\. MVP vs Future Features**

This section makes explicit what is IN the MVP and what is planned for later. This prevents scope creep and sets clear expectations.

## **4.1 IN MVP (Now)**

| Feature | Description |
| :---- | :---- |
| Brand Profile creation | Business info, audience, tone, logo, colors |
| AI Strategy Chat | Conversational AI that builds a content strategy |
| Strategy Output Display | Structured strategy view with all sections |
| AI Content Calendar | Day-by-day calendar generated from strategy |
| Calendar Views | Month, Week, Day (List), Agenda views |
| Calendar Item Detail | Full details of each day's content task |
| Design Request (Ticket) | Form to request designs from human KO designers |
| Design Ticket Tracking | Status of submitted design requests |
| Auth (Login/Register) | Email \+ password authentication |
| Privacy Policy | Legal page accessible from app |

## **4.2 NOT IN MVP (Future)**

| Feature | Future Phase | Description |
| :---- | :---- | :---- |
| AI-Generated Designs | Phase 2 | AI creates images, carousels, graphics automatically |
| AI Video Generation | Phase 2 | AI creates Reels, TikToks, video ads |
| AI Copywriting | Phase 2 | AI writes full captions, blog posts, email copy |
| Auto-Posting | Phase 3 | One-click publish to Instagram, X, LinkedIn |
| Analytics Dashboard | Phase 3 | Track performance of published content |
| A/B Testing | Phase 3 | Test different content variations |
| Multi-Brand Support | Phase 2 | Manage multiple brand profiles |
| Team Collaboration | Phase 2 | Multiple users, comments, approvals |
| AI Chat History | Phase 2 | Save and revisit past strategy sessions |

**IMPORTANT:** CRITICAL DISTINCTION: In MVP, when the calendar says Design Required, the user clicks Request Design which sends a ticket to a HUMAN designer at KO. The AI does NOT create designs. The human designer creates the asset and delivers it back to the user through the platform.

# **5\. Detailed User Journey**

This is the complete step-by-step experience of a user moving through KO OS MVP for the first time. Every screen, every click, every state change is documented.

## **5.1 Landing on KO OS (First Visit)**

0. User types koos.ko.com into their browser (or clicks a link from the KO website).

1. The KO OS Entry Page loads. The background is deep navy (\#000D20). On the left side, the user sees: the KO OS wordmark (KO logo \+ OS text), the headline Your Brand Brain — powered by KO. in large white text, a one-line description Turn raw ideas into brand-ready campaigns. Faster., and two buttons side by side: Login (outline) and Start Creating (filled blue).

2. On the right side, a subtle looping animation plays inside a contained panel — the KO mark slowly rotating or pulsing at low opacity. It is noticeable but not distracting.

3. At the very bottom of the page, a small Privacy Policy link sits in muted gray text.

4. The user has never been here before, so they click Start Creating.

## **5.2 Authentication (New User)**

5. Because the user is not logged in, clicking Start Creating routes them to the Login / Create Account screen.

6. A centered card appears on the dark background. At the top of the card: the KO OS wordmark. Below it: the title Welcome to KO OS and subtitle Create your account to get started.

7. The form shows: Email Address field, Password field (with show/hide eye icon), and a primary button Create Account.

8. Below the button: a divider line with or in the center, then a secondary text link: Already have an account? Sign in instead.

9. At the bottom: a ghost button Back to home.

10. The user enters their email and password, clicks Create Account.

11. The button shows a loading spinner. After 1-2 seconds, a success toast appears: Account created. The user is automatically logged in.

## **5.3 Create Brand Profile (Forced First Step)**

12. Immediately after login, the app checks: does this user have a Brand Profile? The answer is no — this is their first time.

13. The app routes to the Create Brand page. A message appears at the top: Welcome\! Let's set up your brand first. This helps us create better strategies for you.

14. The page title reads: Create Your Brand. Below it: Tell us about your business so we can create strategies and content calendars that match your brand.

15. Section 1 — Business Basics (all required):

* Brand/Business Name — text input. User types: Killa Skincare.

* Business Overview — textarea. User types: We make clean, affordable skincare products for young professionals who want effective routines without 20 steps.

* Business Type — dropdown. User selects: E-commerce / Product.

* Stage — dropdown. User selects: Pre-launch / New product.

16. Section 2 — Brand Direction (optional but recommended):

* Target Audience — text input. User types: Women 22-38, urban, Instagram-active, care about ingredients.

* Offer — text input. User types: A 3-step skincare kit for $49.

* Tone/Voice — dropdown. User selects: Friendly & Educational.

* Primary Goal — dropdown. User selects: Product Launch / Awareness.

17. Section 3 — Brand Assets (optional but recommended):

* Logo Upload — drag-and-drop zone. User drags their logo.png file. A preview thumbnail appears with the filename and a remove button.

* Primary Color — color picker. User enters: \#E8B4B8 (soft pink).

* Secondary Color — color picker. User enters: \#2C5F2D (forest green).

18. The ‘Save Brand’ button at the bottom starts disabled (gray). As the user fills in the required fields, it becomes enabled (blue).

19. User clicks Save Brand. Button shows loading state. Success toast: Brand profile created\!

20. After 1 second, the app automatically routes to the Campaign workspace.

## **5.4 Create Campaign Workspace (AI Chat)**

21. The campaign page loads. The layout is a full-screen chat interface. The left side (or top on mobile) shows the page title Campaigns with a subtitle: Tell KO what you are working on and we will build a content strategy for you.

22. The main area is an empty chat canvas with a welcome message from KO (the AI):

* Avatar: a small KO icon (24px, blue circle).

* Message: Hi\! I am KO, your content strategist. To build the perfect strategy for you, I need to understand your goals. What are you working on right now? (For example: a product launch, a seasonal sale, building brand awareness?)

23. Below the AI message, a row of suggested prompt chips appears:

* I am launching a new product

* Running a seasonal promotion

* Building brand awareness

* Re-engaging existing customers

* Growing my social media presence

24. At the bottom: a chat input bar with placeholder Ask KO anything about your campaign... and a send button (paper plane icon, blue).

## **5.5 The Strategy Conversation (Back-and-Forth)**

25. User clicks the chip: I am launching a new product.

26. Their message appears in a right-aligned bubble (Surface 2 background, white text).

27. The AI responds: Great\! A product launch is one of my favorites. Let's make it count. A few quick questions: What is the product, and who is it for?

28. User types: It is a 3-step skincare kit for busy women who want a simple routine. Price is $49. Launching in 3 weeks.

29. AI responds: Perfect. That gives us a solid 3-week runway. Which platforms are you currently active on, and which ones matter most for this launch?

30. User types: Mainly Instagram. We also have an email list of about 2,000 people. We do not blog yet but we are open to it.

31. AI responds: Instagram \+ email is a strong combo for a launch. With 2,000 subscribers, email will drive your conversions. Instagram will build buzz. Based on what you have told me, here is what I recommend:

32. The AI then outputs the full strategy in a structured format inside the chat:

* Campaign Name: The Fresh Drop

* Objective: Drive 300+ pre-orders in 21 days

* Target: Women 22-38, urban, skincare-curious, Instagram-active

* Key Message: Clean beauty in 3 steps. No fluff, no 20-step routines.

* Channels: Instagram (primary buzz), Email (primary conversion), Blog (SEO long-term)

* Content Mix: 6 carousel posts, 3 Reels, 4 stories, 2 emails, 1 blog post

* Timeline: Teaser Phase (Days 1-7), Launch Phase (Days 8-14), Sustain Phase (Days 15-21)

33. At the bottom of the strategy, two buttons appear: Edit Strategy (secondary/outline) and Generate Calendar (primary/filled).

## **5.6 Generating the Content Calendar**

34. The user reviews the strategy and clicks Generate Calendar.

35. The button changes to a loading state: Generating calendar... with a spinner. The chat area dims slightly.

36. After 3-5 seconds, the calendar appears. The view defaults to Week View (current week). The user sees a 7-column grid with days of the week.

37. Each day has 1-2 calendar items shown as small cards. For example:

* Monday: Instagram carousel — 5 Ingredients That Make Us Different (Design Required)

* Tuesday: Blog post — Behind the Scenes: How We Source Our Ingredients

* Wednesday: Instagram Reel — Unboxing the 3-Step Kit (Design Required)

* Thursday: Email blast — Early Access: The Fresh Drop Is Here

* Friday: Instagram story — Poll: Which step is your favorite?

38. Items that need design have a small blue dot indicator and the text Design Required in blue.

39. The user can switch between Month, Week, Day, and Agenda views using a view toggle at the top of the calendar.

## **5.7 Viewing a Calendar Item**

40. The user clicks on the Monday carousel item. A detail panel opens (right-side drawer on desktop, bottom sheet on mobile).

41. The drawer shows:

* Title: 5 Ingredients That Make Us Different

* Date & Time: Monday, June 16 at 9:00 AM

* Platform: Instagram

* Content Type: Carousel (5 slides, 1080x1080 each)

* Caption/Brief: Slide 1: Hook — Did you know the average skincare product has 25 ingredients? We use 5\. Slide 2-5: One ingredient per slide with a short benefit. End with a CTA to shop.

* Design Required: Yes — Instagram Carousel (5 slides)

* Status: Draft

42. At the bottom of the drawer: two buttons. Left: Close (ghost). Right: Request Design (primary, filled).

## **5.8 Requesting a Design (Design Ticket)**

43. The user clicks Request Design. The calendar drawer closes and a Design Request modal opens.

44. Modal title: Request Design. Subtitle: We will create this for you. A KO designer will deliver within 24-48 hours.

45. The form is pre-filled:

* Campaign: The Fresh Drop (read-only, gray badge)

* Calendar Item: 5 Ingredients That Make Us Different (read-only)

* Design Type: Instagram Carousel (pre-selected from the calendar item, but user can change via dropdown)

* Dimensions: 1080 x 1080px per slide, 5 slides (auto-filled based on design type)

* Brief: Auto-filled from the calendar item caption field. User can edit.

* Your Brand Colors: Two color swatches shown — Primary \#E8B4B8, Secondary \#2C5F2D (pulled from Brand Profile).

* Your Logo: Thumbnail of uploaded logo shown. Link: Replace logo in Brand Settings.

* Notes: Empty textarea. Placeholder: Any specific direction for the designer? Reference images, style preferences, etc.

* Due Date: Optional date picker. Default: 2 days before the calendar item date.

46. Footer buttons: Cancel (secondary/outline) and Submit Request (primary/filled).

47. User reviews everything, adds a note: Please use our pink as the background color for the hook slide. Keep it clean and minimal. Clicks Submit Request.

## **5.9 Design Ticket Confirmation**

48. The modal content swaps to a confirmation screen:

* Checkmark icon (48px, green \#97C459).

* Title: Design request submitted\!

* Message: Your request has been sent to the KO design team. You will receive a notification when your design is ready.

* Ticket summary: Design type, number of slides, due date.

* Button: Back to Calendar (primary, full width). (SO WE MIGHT NEED TO ADD A BUTTON THAT SAYS DOWNLOAD INVOICE OR GET INVOICE)

49. User clicks Back to Calendar. Modal closes. Back on the calendar, the Monday carousel item now shows a new status: Design Ticket Submitted with a small clock icon in muted green.

50. The user continues reviewing other calendar items, requesting designs where needed, and marking items as ready when they have everything they need.

## **5.10 Design Delivery (Designer Side \+ User Notification)**

51. Later (within 24-48 hours), a KO designer receives the ticket, reviews the brief, brand colors, and logo, creates the 5-slide carousel in their design tool (Figma, Photoshop, etc.), and uploads the final assets to the platform.

52. The user receives a notification: Your design for 5 Ingredients That Make Us Different is ready\! The notification appears as a toast (bottom-right on desktop, top on mobile) with a blue left border.

53. User clicks the notification. The calendar item detail opens, now showing a Design Delivered section with thumbnail previews of all 5 slides. User can click each thumbnail to view full-size, or download all as a ZIP file.

54. The calendar item status updates to: Ready to Publish.

## **5.11 Returning User Flow**

55. A returning user lands on the Entry Page and clicks Login (outline button).

56. They enter their credentials and sign in.

57. The app checks: they already have a Brand Profile. They skip the Create Brand step and land directly on their most recent workspace, either the campaign page or the Calendar, depending on where they left off.

58. They can start a new campaign conversation, review existing calendars, check design ticket statuses, or update their brand profile.

# **6\. Information Architecture**

All pages and views that exist in the KO OS MVP.

## **6.1 Public / Pre-Auth Pages**

| Page | URL Pattern | Description |
| :---- | :---- | :---- |
| KO OS Entry | / | Landing page with Start Creating and Login CTAs |
| Privacy Policy | /privacy | Legal privacy policy (publicly accessible) |

## **6.2 Auth Pages**

| Page | URL Pattern | Description |
| :---- | :---- | :---- |
| Login | /auth/login | Email \+ password sign in |
| Create Account | /auth/register | New user registration |

## **6.3 App Pages (Authenticated)**

| Page | URL Pattern | Description | Required |
| :---- | :---- | :---- | :---- |
| Create Brand | /brand/create | Brand profile form (first-time only) | Yes — forced if no brand |
| Brand Profile | /brand | View/edit existing brand profile | Yes |
| Campaign Workspace | /strategy | AI chat for strategy creation | Yes |
| Strategy Detail | /strategy/:id | View a saved strategy | Yes |
| Content Calendar | /calendar | Calendar view (Month/Week/Day/Agenda) | Yes |
| Calendar Item Detail | /calendar/item/:id | Detail drawer/modal for one item | Yes (drawer) |
| Design Request | /design-request/new | Form to create a design ticket | Yes (modal) |
| Design Ticket Detail | /design-request/:id | View status of submitted ticket | Yes |
| Design Delivered View | /calendar/item/:id/design | View delivered design assets | Yes (in drawer) |
| Account Menu | Dropdown only | Profile, Privacy Policy, Logout | Yes |

# **7\. Navigation Model**

## **7.1 Sidebar Navigation (Desktop)**

Left sidebar, fixed position. Background: \#00204F. Width: 240px expanded, 72px collapsed. Border-right: 1px solid rgba(255,255,255,0.06).

| Nav Item | Icon | Route | Behavior |
| :---- | :---- | :---- | :---- |
| Dashboard | Board Icon | /dashboard | Show and overview of the brands and campaigns. |
| Brands | Palette icon | /brands | Shows Brand Profile (or Create Brand if none) |
| Champaigns | Lightbulb icon | /Campaigns | Opens AI strategy chat workspace |
| Calendar | Calendar icon | /calendar | Opens content calendar (default Week view) |
| Design Tickets | Ticket/Tag icon | /design-request | List of all submitted design tickets with status |

Items appear in this exact order. Each item: height 44px, padding 0 16px, icon 20px \+ label 13px/500, gap 12px. Active item: white text \+ 2px \#138BC8 indicator bar on left edge. Inactive: \#A7B6C7 text. Hover: background rgba(255,255,255,0.04), text \#FFFFFF.

## **7.2 Sidebar Collapse (Desktop)**

* Collapse toggle: icon-only button (40px, ghost style) at bottom of sidebar.

* Collapsed state: icons only, no labels. Width shrinks to 72px.

* Hover on collapsed icon: tooltip appears showing the label (background Surface 2, text \#FFFFFF, border-radius 6px, padding 4px 8px).

* Icons stay vertically aligned, same 20px size, same gap between items (8px).

## **7.3 Mobile Drawer Navigation**

* Trigger: hamburger icon button (top-left of top bar).

* Drawer slides in from left, width 280px, background \#00204F.

* Backdrop: rgba(0,0,0,0.5), click to close.

* Close methods: tap backdrop, swipe left, tap X button (top-right of drawer).

* Drawer header: KO OS wordmark \+ close X.

* Drawer body: same nav items as desktop sidebar, full width, stacked vertically.

* Drawer footer: collapse toggle removed (not applicable on mobile).

## **7.4 Top Bar**

| Element | Position | Desktop | Mobile |
| :---- | :---- | :---- | :---- |
| Hamburger / Toggle | Left | Collapse sidebar icon | Open drawer icon |
| Page Title | Center-Left | 22px/600/\#FFFFFF | 18px/600/\#FFFFFF (centered) |
| Brand Name | Below title | 13px/\#6F8599 — Shows active brand name | Hidden (space constraint) |
| Profile Avatar | Right | 36px circle, \#00204F bg, initials or icon | Same |
| Notification Bell | Right of avatar | 20px icon, \#A7B6C7, red dot for unread | Same |

## **7.5 Profile Dropdown Menu**

* Trigger: click avatar. Dropdown: 200px wide, background \#001F3D, border-radius 12px, border 1px solid rgba(255,255,255,0.06), shadow 0 8px 24px rgba(0,0,0,0.35).

* Menu items: Account Settings (disabled in MVP, grayed out), Privacy Policy, Divider, Logout.

* Each item: 13px, padding 10px 12px, border-radius 8px. Hover: background rgba(255,255,255,0.04).

* Logout hover: text color shifts to \#D47575 (subtle red caution).

* Dismiss: click outside, press Escape.

# **8\. Screen-by-Screen UI Specification**

## **8A. KO OS Entry Page**

### **Purpose**

Confirm what KO OS is (one sentence). Make the next step obvious. Provide Login for returning users. Feel premium and calm (Night KO).

### **Layout — Desktop**

Full viewport height (100vh). Two-column split:

* Left column (55%): Vertically centered content block. Padding: 48px left, 32px right.

* Right column (45%): Full height visual panel. Background: Surface 1 (\#00162E). Border-left: 1px solid rgba(255,255,255,0.06).

### **Left Column Contents (top to bottom)**

59. KO OS Wordmark: KO logo mark (32px blue circle with white KO) \+ OS text (22px/600/\#FFFFFF). Gap: 8px. Position: top-left, 32px from top edge.

60. Spacer: flexible space pushing content to vertical center.

61. Headline: Your Brand Brain — powered by KO. Font: 48px/Bold/110% line-height. Color: \#FFFFFF. Max-width: 480px.

62. Spacer: 16px.

63. Description: AI-powered content strategies and calendars. Human designers bring them to life. Font: 16px/Regular/160%. Color: \#A7B6C7. Max-width: 420px.

64. Spacer: 32px.

65. CTA Row: Two buttons side by side, gap 12px.

66.   a) Login button (left, outline): transparent bg, \#FFFFFF text, 1px solid rgba(19,139,200,0.4) border. Height: 48px. Padding: 0 24px. Border-radius: 10px. Hover: bg rgba(19,139,200,0.08), border rgba(19,139,200,0.6).

67.   b) Start Creating button (right, filled): \#138BC8 bg, \#FFFFFF text. Height: 48px. Padding: 0 28px. Border-radius: 10px. Hover: \#0F7EB8.

68. Spacer: pushes footer to bottom.

69. Footer: Privacy Policy link (13px/\#6F8599). Hover: \#FFFFFF \+ underline.

### **Right Column — Looping Visual**

* Container: full height, centered content.

* Visual: slowly rotating KO mark (the KO letters in a large, subtle treatment).

* KO mark: 200px, color rgba(19,139,200,0.08), rotating 360 degrees over 60 seconds, linear, infinite.

* Behind the mark: subtle concentric circles (3 rings) pulsing outward, rgba(19,139,200,0.03), each ring 20px apart, animation 4s ease-in-out infinite.

* The visual is ambient — it creates atmosphere without demanding attention.

### **Layout — Mobile**

Single column. Stack order:

70. KO OS wordmark — top, 24px from edge, left-aligned.

71. Headline: 36px (scaled down 25%). Left-aligned.

72. Description: 15px. Left-aligned. Max-width: none (full width minus padding).

73. CTA stack: Start Creating (filled, full width, 52px height) above Login (outline, full width, 52px height). Gap: 12px.

74. Looping visual: 180px height max, centered. KO mark at 120px.

75. Privacy Policy: centered, 13px.

### **Interactions**

* Click Start Creating: if not authenticated → /auth/login. After auth → if no brand → /brand/create, else → /strategy.

* Click Login: → /auth/login. After auth → same routing as above.

* Click Privacy Policy: → /privacy (new tab).

* Auth service down: show banner at top of page. Background \#1A3A4A, text \#A7B6C7, padding 12px 24px, icon (alert triangle) \+ text: Login temporarily unavailable. Please try again later. Dismissible X on right.

## **8B. Auth Screens**

### **Layout**

Centered card on full-viewport dark background. Page background: \#000D20.

* Card: max-width 420px, centered both horizontally and vertically.

* Card background: Surface 1 (\#00162E). Border-radius: 16px. Border: 1px solid rgba(255,255,255,0.06). Padding: 40px.

* Card shadow: 0 8px 32px rgba(0,0,0,0.4).

### **Card Contents (Login Mode)**

76. KO OS wordmark: centered, 28px mark \+ 18px OS text.

77. Spacer: 24px.

78. Title: Welcome back. 24px/600/\#FFFFFF.

79. Subtitle: Sign in to your KO OS account. 14px/400/\#A7B6C7.

80. Spacer: 24px.

81. Email field: label Email Address (12px/500/\#A7B6C7), input (44px height, \#00162E bg, rgba(255,255,255,0.06) border, 10px radius, \#FFFFFF text, 14px). Placeholder: you@company.com.

82. Spacer: 16px.

83. Password field: same style as email. Label: Password. Placeholder: Enter your password. Right side of input: eye icon button (show/hide toggle). Icon: 20px, \#6F8599, hover \#FFFFFF.

84. Spacer: 8px.

85. Forgot password link: 13px/\#138BC8. Hover: underline. (Functionality: post-MVP, can show Coming Soon toast).

86. Spacer: 24px.

87. Sign In button: primary, full width, 44px height.

88. Spacer: 20px.

89. Divider: horizontal line (rgba(255,255,255,0.06)) with or text centered (12px/\#6F8599).

90. Spacer: 20px.

91. Secondary link: Need an account? Create one. 14px/\#138BC8. Click switches card to Register mode.

92. Spacer: 16px.

93. Back button: ghost, full width, 40px. Text: Back to home. Click routes to /.

### **Card Contents (Register Mode)**

Same layout as Login, differences:

* Title: Create your account.

* Subtitle: Start creating content strategies with KO.

* Password field: adds a strength indicator below (4 segments: Weak/Fair/Good/Strong, colors from red to green).

* Button: Create Account.

* Link: Already have an account? Sign in.

### **Field Validation Behavior**

| Field | Validation Rule | Error State |
| :---- | :---- | :---- |
| Email | Required, valid email format (regex) | Red border (\#8B4040), text: Please enter a valid email address |
| Password | Required, min 8 characters | Red border, text: Password must be at least 8 characters |
| Password (register) | Required, min 8 chars, show strength | Weak \= red border \+ red text |

### **Loading & Error States**

* Loading: button text replaced by inline spinner (16px, KO Blue). Button disabled. Width stays fixed — no layout shift.

* Network error: banner appears below the card. Background \#1A3A4A, border-left 3px \#D47575, text \#A7B6C7, padding 12px 16px.

* Invalid credentials: inline error below password field. 12px/\#D47575. Message: Incorrect email or password.

* Success (register): toast Account created\! Welcome to KO OS. Auto-route after 1 second.

* Success (login): brief flash of loading on button, then instant route (no toast — faster feel).

## **8C. App Shell (Top Bar \+ Sidebar \+ Content)**

### **Overall Structure**

The app shell wraps all authenticated pages. It provides consistent navigation, page context, and access to account actions.

| Region | Background | Width | Position | Notes |
| :---- | :---- | :---- | :---- | :---- |
| Sidebar | \#00204F | 240px (72px collapsed) | Fixed left | Nav items \+ collapse toggle |
| Top Bar | Transparent or \#000D20 | calc(100% \- 240px) | Fixed top, right of sidebar | Title \+ brand name \+ avatar |
| Content Area | \#000D20 | calc(100% \- 240px) | Below top bar, right of sidebar | Scrollable, padding 24px |

### **Top Bar (Desktop)**

* Height: 56px. Background: transparent (content scrolls behind) OR \#000D20 with bottom border 1px solid rgba(255,255,255,0.06) if page is scrolled.

* Left section: Sidebar collapse toggle (icon button, 40px, ghost) \+ page title (22px/600/\#FFFFFF) \+ brand name below (13px/\#6F8599, e.g., using: Killa Skincare).

* Right section: Notification bell (20px icon, \#A7B6C7, red dot 8px for unread) \+ avatar button (36px circle, \#00204F bg, white initials, 13px/600).

* Avatar hover: background \#001F3D, border 1px solid rgba(19,139,200,0.4), transition 160ms.

### **Top Bar (Mobile)**

* Height: 56px. Background: \#000D20. Bottom border: 1px solid rgba(255,255,255,0.06).

* Left: Hamburger icon button (opens mobile drawer).

* Center: Page title (18px/600/\#FFFFFF).

* Right: Avatar button (same as desktop, 32px).

### **Content Area**

* Background: \#000D20.

* Padding: 24px (desktop), 16px (mobile).

* Max-width: 1280px. If screen wider, content centers with equal margins.

* Min-height: calc(100vh \- 56px) to ensure footer space if needed.

* Overflow-y: auto (content scrolls, sidebar and top bar stay fixed).

## **8D. Create Brand (Required First Step)**

### **Purpose**

Capture everything KO needs to know about the user's brand. This is the foundation for all AI-generated strategies and all human-created designs. Without a Brand Profile, the AI cannot create meaningful strategies and designers cannot create on-brand assets.

### **Forced Routing Behavior**

* After login, the app checks: does this user have a completed Brand Profile?

* If NO: route to /brand/create. All sidebar nav items except Brand are disabled (grayed out, non-clickable).

* If YES: route to /campaign (the main workspace).

* The Brand sidebar item always shows a red dot indicator if the profile is incomplete, and a checkmark if complete.

### **Page Layout**

* Page title: Create Your Brand (32px/700/\#FFFFFF).

* Subtitle: Tell us about your business. This helps our AI build better strategies and our designers create on-brand assets. (14px/400/\#A7B6C7).

* Progress indicator: horizontal steps (3 steps) at the top. Step 1: Business Basics, Step 2: Brand Direction, Step 3: Brand Assets. Active step: \#138BC8 text \+ blue underline. Completed step: \#97C459 green checkmark. Future step: \#6F8599 muted text.

* Form area: single column, max-width 640px, centered.

* Step navigation: Previous (secondary, left) and Next/Save (primary, right) buttons at bottom of each step.

### **Step 1: Business Basics (All Required)**

| Field | Type | Validation | Placeholder |
| :---- | :---- | :---- | :---- |
| Brand/Business Name | Text input | Required, min 2 chars, max 100 | e.g., Killa Skincare |
| Business Overview | Textarea (3 rows, auto-expand to 6\) | Required, min 20 chars, max 500 | What does your business do? Who do you serve? What makes you different? |
| Business Type | Select dropdown | Required | Select a type... |
| Stage | Select dropdown | Required | Select your current stage... |

Business Type options: E-commerce / Product, Service-based, SaaS / Technology, Content Creator / Influencer, Agency / Consultancy, Non-profit, Restaurant / Food, Fashion / Beauty, Health / Wellness, Education, Other.

Stage options: Pre-launch / New business, Early growth (first 1-2 years), Established (3+ years), Rebranding, Launching a new product/service.

### **Step 2: Brand Direction (Optional but Recommended)**

| Field | Type | Validation | Placeholder |
| :---- | :---- | :---- | :---- |
| Target Audience | Text input | Optional, max 200 chars | e.g., Women 25-40, urban, skincare enthusiasts |
| What You Sell / Offer | Text input | Optional, max 200 chars | e.g., 3-step skincare kit for $49 |
| Tone of Voice | Select dropdown | Optional | Select a tone... |
| Primary Goal | Select dropdown | Optional | What is your main objective? |

Tone of Voice options: Professional & Authoritative, Friendly & Conversational, Playful & Fun, Bold & Edgy, Calm & Trustworthy, Luxurious & Sophisticated, Educational & Helpful, Aspirational & Inspirational.

Primary Goal options: Product Launch, Brand Awareness, Drive Sales / Conversions, Grow Social Media Following, Build Email List, Re-engage Existing Customers, Seasonal Promotion, Establish Thought Leadership.

### **Step 3: Brand Assets (Optional but Recommended)**

| Field | Type | Validation | Notes |
| :---- | :---- | :---- | :---- |
| Logo Upload | File upload (PNG, SVG, JPG) | Optional, max 5MB | Preview thumbnail shown after upload. Remove button available. |
| Primary Brand Color | Color picker \+ hex input | Optional, validates hex | Used as main color in designs |
| Secondary Brand Color | Color picker \+ hex input | Optional, validates hex | Used as accent in designs |
| Additional Colors | Color picker \+ hex input (up to 3\) | Optional | Extra brand colors if applicable |

### **File Upload Component (Detailed Spec)**

* Default state: dashed border 2px rgba(255,255,255,0.12), border-radius 10px, background \#00162E, padding 32px, text centered.

* Content: Upload icon (24px, \#6F8599) \+ primary text Click to upload or drag and drop (14px/\#A7B6C7) \+ subtext PNG, SVG, or JPG up to 5MB (12px/\#6F8599).

* Hover state: dashed border rgba(19,139,200,0.6), background rgba(19,139,200,0.04), cursor pointer.

* Drag-over state: dashed border \#138BC8, background rgba(19,139,200,0.08).

* Uploading state: dashed border rgba(255,255,255,0.06), progress bar (thin, \#138BC8 fill on \#1A3A4A track), filename \+ percentage.

* Uploaded state: solid border rgba(255,255,255,0.06), file thumbnail (64px) \+ filename \+ size \+ remove X button (ghost, 16px).

* Error state: dashed border \#8B4040, error icon \+ error text (12px/\#D47575).

### **Color Picker Component (Detailed Spec)**

* Layout: horizontal row. Color swatch (32px square, border-radius 6px, border 1px solid rgba(255,255,255,0.12)) \+ hex text input (100px wide).

* Clicking swatch opens native HTML color picker input (type=color, visually hidden but functionally accessible).

* Hex field: validates on blur. Accepts 3-char (\#FFF) or 6-char (\#FFFFFF) hex. Auto-prefixes \# if missing.

* Invalid hex: red border (\#8B4040), inline error (12px/\#D47575): Enter a valid hex color.

* Swatch updates in real-time as hex value changes.

### **Validation & UX Behavior**

* Required fields (Step 1): validated on blur. Empty \= red border \+ inline error.

* Next button: disabled until all fields in current step are valid. Disabled style: bg \#1A3A4A, text \#6F8599.

* Enabled Next button: bg \#138BC8, text \#FFFFFF.

* Final Save button (Step 3): same disabled/enabled logic based on Step 1 completion.

* Click Save: button shows loading spinner. API call saves brand profile.

* Success: toast appears (bottom-right). Background Surface 2, left border 3px \#138BC8, text \#FFFFFF: Brand profile created\! Auto-dismiss 4s.

* Auto-route: after 1.5 seconds, navigate to /strategy.

* Form persistence: if user refreshes mid-form, progress is saved to localStorage and restored on return.

## **8E. Strategy Workspace (AI Chat)**

### **Purpose**

The primary workspace where users chat with the AI to create content strategies. This is a full-screen chat interface, the AI asks questions, the user responds, and the AI generates a structured strategy. Once approved, the user clicks Generate Calendar to convert the strategy into a day-by-day content calendar.

### **Layout**

* Full height layout (100vh \- top bar). Three regions:

*   Left panel (280px, optional on desktop, hidden on mobile): Campaign history list; past strategy sessions shown as cards with date \+ campaign name. Click to reopen. New Strategy button at top (primary, full width).

*   Main chat area (flex: 1): Message history \+ input. Background: \#000D20.

*   Right panel (320px, collapsible): Strategy preview — when a strategy has been generated, it shows here in a structured, scannable format. Collapse toggle at top.

### **Empty State (No Active Strategy)**

* When user first lands here, the chat area shows a welcome screen:

* Centered content: KO icon (48px, \#6F8599 at 30% opacity).

* Title: What are you working on? (24px/600/\#FFFFFF).

* Subtitle: Tell me about your campaign, product, or goal and I will build a content strategy for you. (14px/400/\#A7B6C7, max-width 400px, centered).

* Suggested prompt chips (2 rows, centered):

*   Row 1: I am launching a new product | Running a seasonal sale | Building brand awareness

*   Row 2: Re-engaging customers | Growing social media | Content for a new platform

* Each chip: background rgba(255,255,255,0.06), text 13px/\#A7B6C7, border-radius 999px, padding 8px 16px. Hover: background rgba(19,139,200,0.12), text \#FFFFFF, cursor pointer.

### **Chat Message Bubbles**

| Property | AI Message | User Message |
| :---- | :---- | :---- |
| Alignment | Left-aligned | Right-aligned |
| Max-width | 85% of chat area | 75% of chat area |
| Background | Surface 1 (\#00162E) | Surface 2 (\#001F3D) |
| Text color | \#FFFFFF | \#FFFFFF |
| Border | 1px solid rgba(255,255,255,0.06) | 1px solid rgba(19,139,200,0.2) |
| Border-radius | 12px (top-left 4px) | 12px (top-right 4px) |
| Padding | 14px 18px | 14px 18px |
| Font | 14px/400/160% | 14px/400/160% |
| Avatar | KO icon (24px, blue circle, left of bubble) | None (or user initials) |
| Timestamp | 12px/\#6F8599, below bubble | 12px/\#6F8599, below bubble |

### **AI Strategy Output Display**

When the AI completes a strategy, it renders as a structured card inside the chat, followed by the Edit Strategy and Generate Calendar action buttons.

* Strategy card: background Surface 1 (\#00162E), border 1px solid rgba(19,139,200,0.3), border-radius 12px, padding 20px. Left border: 3px solid \#138BC8.

* Card header: STRATEGY badge (11px/500/\#138BC8, bg rgba(19,139,200,0.15), pill) \+ campaign name (18px/600/\#FFFFFF).

* Sections stacked vertically, each with:

*   Section label: 12px/500/\#6F8599, uppercase, letter-spacing 0.5px.

*   Section value: 14px/400/\#FFFFFF.

*   Divider between sections: 1px solid rgba(255,255,255,0.06).

* Action buttons at bottom of card: Edit Strategy (secondary, outline) \+ Generate Calendar (primary, filled). Gap: 12px.

### **Chat Input Bar**

* Position: fixed to bottom of chat area.

* Container: Surface 1 (\#00162E), border 1px solid rgba(255,255,255,0.06), border-radius 12px, padding 10px 14px.

* Text area: multiline, auto-resize (min 1 row, max 4 rows). Background transparent. Text \#FFFFFF, placeholder \#6F8599. Placeholder: Ask KO about your campaign...

* Send button: 36px circle, bg \#138BC8, white paper plane icon (18px). Disabled when textarea empty (bg \#1A3A4A). Hover when enabled: \#0F7EB8.

* Focus state: container border rgba(19,139,200,0.6), glow 0 0 0 3px rgba(19,139,200,0.15).

### **AI Loading State**

* When user sends a message and AI is processing:

* Typing indicator: three pulsing dots (8px circles, \#138BC8, staggered animation 0.2s delay each).

* Pulsing dots animation: opacity 0.3 to 1.0, 0.8s ease-in-out infinite, staggered.

* Shown in an AI message bubble (same style but smaller, 60px width).

* Input bar is disabled during AI response. Textarea gets opacity 0.5.

### **AI Error States**

* Error: API/quota exhausted — AI message bubble with error styling:

*   Background: rgba(212,117,117,0.08). Border: 1px solid rgba(212,117,117,0.3).

*   Icon: alert triangle (16px, \#D47575).

*   Text: I am temporarily unavailable. Our AI service has reached its limit. Please try again in a few moments. (14px/\#A7B6C7).

*   Action button: Try Again (secondary, 13px). Clicking resends the last user message.

* Error: network failure — same styling, text: Connection lost. Please check your internet and try again.

### **Right Panel — Strategy Preview**

* When a strategy exists, the right panel shows a scannable summary.

* Panel header: Strategy Summary (14px/600/\#FFFFFF) \+ collapse button (icon-only, ghost).

* Each section: collapsible accordion. Header: section name (13px/500/\#A7B6C7) \+ chevron icon. Content: section value (14px/\#FFFFFF).

* Panel footer: Generate Calendar button (primary, full width). Disabled if strategy is incomplete.

* Collapsed state: panel shrinks to 40px width showing only a vertical label Strategy and an expand arrow.

## **8F. Content Calendar View**

### **Purpose**

Display the AI-generated content calendar in multiple view modes. The calendar shows every piece of content the user needs to create or publish, organized by day. Each item includes the platform, content type, caption brief, posting time, and whether a design asset is required.

### **Layout**

* Page header: Content Calendar (28px/700/\#FFFFFF) \+ subtitle: Your campaign plan, day by day. (14px/\#A7B6C7).

* Campaign selector dropdown: if user has multiple strategies/campaigns, show a dropdown to switch between them. Style: select input, 200px wide. Default: most recent campaign.

* View toggle: segmented control with 4 options: Month | Week | Day | Agenda.

* Toggle style: container bg rgba(255,255,255,0.04), border-radius 8px. Each segment: 13px/500/\#A7B6C7, padding 6px 16px. Active segment: bg Surface 2, text \#FFFFFF, border-radius 8px. Transition: 160ms.

* Calendar controls: Today button (secondary, small) \+ left/right arrows (icon-only, ghost) for navigating time periods.

* Main calendar area: below controls, full remaining height.

### **Month View**

* Grid: 7 columns (Mon-Sun), 5-6 rows depending on the month.

* Grid header: day names (Mon, Tue, Wed...) in 12px/500/\#6F8599, centered.

* Day cell: minimum height 100px. Background: transparent. Border: 1px solid rgba(255,255,255,0.04).

* Day number: 13px/400, top-left of cell, padding 6px. Current day: \#138BC8 \+ bold. Other days: \#A7B6C7. Other month days (padding): \#6F8599 at 50% opacity.

* Items in cell: small cards stacked vertically, max 2 visible (+ N more indicator if overflow).

* Mini card: bg Surface 1, border-radius 4px, padding 3px 6px, margin-top 2px.

* Mini card content: platform icon (12px) \+ truncated title (11px/\#FFFFFF, max 1 line).

* Design indicator: small blue dot (4px, \#138BC8) on right edge of mini card.

* Overflow: \+2 more (11px/\#6F8599, italic). Clicking opens Day view for that date.

* Hover on cell: bg rgba(255,255,255,0.02).

* Click on cell: opens Day view for that date.

* Click on mini card: opens Calendar Item Detail drawer.

### **Week View**

* Grid: 7 columns (Mon-Sun), 1 row. Each column \= one day.

* Column header: day name \+ date (e.g., MON 16). Day name 11px/500/\#6F8599. Date 18px/600/\#FFFFFF. Current day: date in \#138BC8.

* Column: items stacked vertically. Gap: 8px between items.

* Item card: bg Surface 1 (\#00162E), border 1px solid rgba(255,255,255,0.06), border-radius 8px, padding 12px.

* Card content:

*   Time: 11px/\#6F8599 (e.g., 9:00 AM).

*   Platform: 11px/\#A7B6C7 (e.g., Instagram).

*   Title: 13px/500/\#FFFFFF, 1 line max, ellipsis overflow (e.g., 5 Ingredients Carousel).

*   Content type badge: 10px/500, pill, bg rgba(255,255,255,0.06), text \#A7B6C7 (e.g., Carousel).

*   Design status: if required, show Design Required badge (10px/\#85B7EB, bg rgba(19,139,200,0.15)). If ticket submitted, show Pending (10px/\#D4A954, bg rgba(212,169,84,0.15)). If delivered, show Ready (10px/\#97C459, bg rgba(99,153,34,0.15)).

* Card hover: bg Surface 2, border rgba(19,139,200,0.4), translateY(-2px), glow rgba(19,139,200,0.15), shadow 0 4px 12px rgba(0,0,0,0.2). Cursor: pointer. Transition: 220ms.

* Card click: opens Calendar Item Detail drawer.

* All-day items: shown at top of column with slightly different styling (dashed left border).

### **Day View (List)**

* Single column showing all items for the selected day.

* Date header: large format (32px/700/\#FFFFFF, e.g., Monday, June 16). Subtitle: 3 items scheduled.

* Timeline layout: vertical line (1px, rgba(255,255,255,0.06)) running down the left side. Each item has a dot (10px, \#138BC8) on the timeline.

* Each item: full-width card, same styling as Week View cards but larger.

* Card includes all fields: time, platform, content type, title, brief excerpt (2 lines max), design status, and a Request Design button (if design required).

* Request Design button on card: secondary (outline), small (32px height), appears only if design is required and no ticket has been submitted yet.

### **Agenda View**

* Compact list of all upcoming items, sorted by date (ascending).

* Grouped by date: date header (14px/600/\#FFFFFF, sticky at top when scrolling).

* Each item: horizontal row. Time (11px/\#6F8599) \+ Platform (11px/\#A7B6C7) \+ Title (13px/\#FFFFFF) \+ Design status badge.

* Row hover: bg rgba(255,255,255,0.02). Click: opens Calendar Item Detail drawer.

* Past items: dimmed (opacity 0.5). Today's items: normal brightness. Future items: normal.

## **8G. Calendar Item Detail (Drawer / Modal)**

### **Purpose**

Show the full details of a single calendar item. This is where the user reviews what they need to do, reads the content brief, and requests a design if needed.

### **Trigger**

* Click on any calendar item in Month, Week, Day, or Agenda view.

### **Layout — Drawer (Desktop)**

* Slides in from right side. Width: 420px. Height: 100vh. Background: Surface 2 (\#001F3D).

* Border-left: 1px solid rgba(255,255,255,0.06).

* Shadow: \-8px 0 24px rgba(0,0,0,0.3).

* Animation: slide in from right (translateX 100% to 0), 320ms, cubic-bezier(0.2, 0, 0, 1).

* Backdrop: none (drawer sits over content).

### **Layout — Bottom Sheet (Mobile)**

* Slides up from bottom. Full width. Max-height: 90vh. Border-radius: 16px 16px 0 0\.

* Drag handle: 40px x 4px rounded bar, \#6F8599, centered at top.

* Animation: slide up 12px \+ fade, 320ms.

* Backdrop: rgba(0,0,0,0.5), click to close.

### **Drawer Header**

* Close button: X icon (20px, \#A7B6C7), icon-only ghost, top-right. Hover: \#FFFFFF.

* Platform badge: pill chip showing the platform name (e.g., Instagram). Background: rgba(19,139,200,0.15), text 11px/\#85B7EB.

* Content type badge: pill chip next to platform (e.g., Carousel). Background: rgba(255,255,255,0.06), text 11px/\#A7B6C7.

### **Drawer Body**

* Title: 20px/600/\#FFFFFF. E.g., 5 Ingredients That Make Us Different.

* Date & Time row: Calendar icon (14px, \#6F8599) \+ Monday, June 16, 2026 at 9:00 AM (13px/\#A7B6C7).

* Divider: 1px solid rgba(255,255,255,0.06), margin 16px 0\.

* Caption / Brief section:

*   Label: CAPTION BRIEF (12px/500/\#6F8599, uppercase).

*   Content: 14px/400/\#FFFFFF. E.g., Slide 1: Hook — Did you know the average skincare product has 25 ingredients? We use 5\. Here is why each one matters. Slide 2-5: One ingredient per slide with a short benefit description. End slide: CTA to shop the kit.

*   If text is long: show max 6 lines with Expand button (13px/\#138BC8) to reveal full text.

* Divider.

* Design section:

*   Label: DESIGN ASSET (12px/500/\#6F8599, uppercase).

*   If design NOT required: text No design needed for this item. (13px/\#6F8599).

*   If design required, no ticket yet:

*     Status badge: Design Required (11px/\#85B7EB, bg rgba(19,139,200,0.15)).

*     Design type: Instagram Carousel — 5 slides (1080x1080px each).

*     Button: Request Design (primary, full width, 44px).

*   If design ticket submitted:

*     Status badge: Design Submitted (11px/\#D4A954, bg rgba(212,169,84,0.15)).

*     Ticket ID: \#DT-00123 (13px/\#6F8599).

*     Due date: Expected by Wednesday, June 18 (13px/\#A7B6C7).

*     Button: View Ticket (secondary, outline, full width). Links to Design Tickets page.

*   If design delivered:

*     Status badge: Design Ready (11px/\#97C459, bg rgba(99,153,34,0.15)).

*     Thumbnail grid: 2x3 grid of slide thumbnails (each 80px, border-radius 6px).

*     Download button: secondary, outline, full width. Text: Download All (ZIP).

*     View Full Size link: ghost, 13px/\#138BC8. Opens lightbox gallery.

* Divider.

* Status section:

*   Label: STATUS (12px/500/\#6F8599, uppercase).

*   Dropdown: Draft (default), In Progress, Ready, Published.

*   Dropdown style: same as all select inputs.

*   Changing status updates immediately (no save button needed).

### **Drawer Footer**

* Close button: ghost, full width. Text: Close.

## **8H. Design Request (Ticket to Human Designers)**

### **Purpose**

When a calendar item requires a visual asset, this form lets the user submit a Design Ticket to KO's human design team. The ticket includes the design brief, brand assets, and any user notes. A human designer picks up the ticket, creates the asset, and delivers it back.

**IMPORTANT:** IMPORTANT: This form sends a request to HUMAN designers at KO. The AI does NOT create designs in MVP. The design team receives the ticket, reviews the brief and brand assets, creates the design manually, and uploads it back to the platform.

### **Trigger**

* Click Request Design button on a calendar item card (in Day or Week view).

* Click Request Design button inside the Calendar Item Detail drawer.

### **Layout — Modal (Desktop)**

* Backdrop: rgba(0,0,0,0.6), backdrop-filter blur(4px). Click to close (with confirmation if form is dirty).

* Modal: Surface 2 (\#001F3D), border-radius 16px, max-width 560px, max-height 90vh.

* Border: 1px solid rgba(255,255,255,0.06). Shadow: 0 16px 48px rgba(0,0,0,0.5).

* Overflow: auto (scrolls internally if content exceeds height).

* Animation: fade in \+ scale 0.98 to 1.0, 320ms.

### **Layout — Bottom Sheet (Mobile)**

* Slides up from bottom, full width, max-height 90vh. Border-radius: 16px 16px 0 0\.

* Drag handle: 40x4px rounded bar, \#6F8599, centered. Swipe down to close.

### **Modal Header**

* Close X button: top-right, icon-only ghost.

* Title: Request Design (22px/600/\#FFFFFF).

* Subtitle: A KO designer will create this for you. Expected delivery: 24-48 hours. (13px/\#A7B6C7).

### **Form Fields**

* Campaign (read-only): gray badge showing campaign name. E.g., The Fresh Drop. Label: Campaign.

* Calendar Item (read-only): text showing item title. E.g., 5 Ingredients That Make Us Different. Label: Content.

* Design Type (select, required): dropdown. Options: Instagram Post (1080x1080), Instagram Carousel (1080x1080 per slide), Instagram Story (1080x1920), Instagram Reel Cover (1080x1920), X/Twitter Post (1200x675), X/Twitter Header (1500x500), LinkedIn Post (1200x627), LinkedIn Carousel (1080x1080 per slide), Facebook Post (1200x630), Blog Header (1200x630), Email Header (600x200), Banner Ad (various), Other. Default: pre-selected from calendar item.

* Number of Slides / Variations (number input, conditional): shown only for Carousel types. Min 2, max 10\. Default: from calendar item or 1\.

* Brief (textarea, pre-filled, editable): auto-filled from calendar item caption. Label: Design Brief. Placeholder: Describe what you need... Min 20 chars. Height: 100px.

* Divider \+ label: YOUR BRAND ASSETS (14px/600/\#FFFFFF).

* Logo preview: 64px thumbnail of uploaded logo \+ filename. If no logo: dashed box with Upload a logo in your Brand Settings link (\#138BC8).

* Brand colors: row of color swatches (24px circles) \+ hex values. Primary, Secondary, Additional.

* Edit brand assets link: 13px/\#138BC8, ghost. Routes to /brand.

* Divider \+ label: EXTRA NOTES (14px/600/\#FFFFFF).

* Notes (textarea, optional): placeholder: Any specific direction? Style preferences, reference links, things to avoid... Height: 80px.

* Reference Images (file upload, optional, up to 3 files): same upload component as Brand Profile. Max 5MB each. PNG, JPG, GIF. Label: Reference images (optional).

* Due Date (date picker, optional): default \= 2 days before the calendar item date. Label: When do you need this by?

### **Form Footer**

* Cancel button: secondary (outline), 40px height. Closes modal, no confirmation if form is empty. If form has content: confirmation dialog Are you sure? Your request will not be saved.

* Submit Request button: primary (filled), 40px height. Disabled until Design Type is selected.

### **Submitting the Request**

* Click Submit Request: button shows loading spinner, form fields disabled.

* API creates the Design Ticket. Response includes ticket ID.

* Modal content swaps to confirmation screen.

### **Confirmation Screen**

* Icon: Checkmark in circle (48px, \#97C459).

* Title: Design request sent\! (24px/600/\#FFFFFF).

* Message: Your request has been assigned to the KO design team. You will receive a notification when it is ready. (14px/\#A7B6C7).

* Ticket summary card:

*   Ticket ID: \#DT-00124 (13px/\#6F8599).

*   Design type: Instagram Carousel — 5 slides (13px/\#FFFFFF).

*   Due by: June 18, 2026 (13px/\#A7B6C7).

* Buttons: View My Tickets (secondary, links to /design-request) \+ Back to Calendar (primary, closes modal).

* Auto-close: modal fades out after 8 seconds if user does not interact.

### **Design Ticket Lifecycle**

| Status | Color | Description | User Action |
| :---- | :---- | :---- | :---- |
| Submitted | \#D4A954 (Gold) | Ticket received by KO design team | Wait for assignment |
| Assigned | \#85B7EB (Blue) | A designer has been assigned | Wait for delivery |
| In Progress | \#138BC8 (KO Blue) | Designer is actively working | Wait for delivery |
| Ready for Review | \#97C459 (Green) | Design is complete, awaiting approval | Review and approve/request revision |
| Delivered | \#97C459 (Green) | Design approved and delivered | Download assets, mark as ready |
| Revision Requested | \#D4A954 (Gold) | User asked for changes | Wait for revised delivery |

### **Design Tickets List Page**

* URL: /design-request.

* Layout: page title Design Tickets (28px/700) \+ subtitle Track all your design requests.

* Filter tabs: All | Submitted | In Progress | Delivered. Same chip/toggle style as calendar view toggle.

* Ticket cards: vertical list. Each card: Surface 1 bg, border, border-radius 12px, padding 16px.

* Card content:

*   Row 1: Ticket ID (\#DT-00124, 12px/\#6F8599) \+ Status badge (right-aligned) \+ Date submitted.

*   Row 2: Design type (14px/500/\#FFFFFF) \+ Campaign name (13px/\#A7B6C7).

*   Row 3: Content item title (13px/\#A7B6C7).

*   Row 4: Due date (12px/\#6F8599) \+ thumbnail preview (if delivered, 48px).

* Card hover: Surface 2 bg, accent border. Click: opens ticket detail.

## **8I. Privacy Policy**

### **Purpose**

Provide a legal baseline accessible from within the product.

### **Layout**

* Page title: Privacy Policy (32px/700/\#FFFFFF).

* Last updated: \[Date\] (13px/\#6F8599).

* Content: standard sections (Information We Collect, How We Use It, Data Sharing, Your Rights, Contact).

* Section headings: 18px/600/\#FFFFFF. Body: 14px/400/\#A7B6C7, max-width 680px.

* Back button: ghost, top-left. Back to app. Routes to previous page.

* Accessible from: entry page footer AND profile dropdown menu.

# **9\. KO OS Design System (Dark Mode)**

## **9.1 Brand Philosophy to UI Rules**

KO OS must feel: Quietly confident (no noisy gradients, no cheap SaaS UI). Disciplined (repeatable components, strict spacing scale, consistent hierarchy). Modern and human (high contrast where it matters, readable type, subtle motion).

* KO Blue (\#138BC8) is the single action colour for CTAs and active states. Do not use it as decoration.

* Hover states deepen colour, never brighten.

* No bouncy easing anywhere. Motion is calm and weighted.

## **9.2 Token Set**

### **Backgrounds & Surfaces**

| Token | Value | Usage |
| :---- | :---- | :---- |
| Base | \#000D20 | App background — deepest layer, page canvas |
| Surface 1 | \#00162E | Cards, panels, sidebar items, input backgrounds |
| Surface 2 | \#001F3D | Modals, dropdowns, popovers, active cards, selected items |
| Secondary / Nav | \#00204F | Sidebar background, top bar, navigation blocks |

### **Action & Accent**

| Token | Value | Usage |
| :---- | :---- | :---- |
| Primary | \#138BC8 | Primary CTAs, active states, key highlights, focus indicators |
| Hover | \#0F7EB8 | Hover state for primary actions — deeper |
| Active | \#0C5F8A | Pressed/clicked state |
| Disabled | \#1A3A4A | Disabled buttons, inactive elements |
| Accent Glow | rgba(19,139,200,0.15) | Focus rings, active card highlights, glow effects |

### **Text Colors**

| Token | Value | Usage |
| :---- | :---- | :---- |
| Text Primary | \#FFFFFF | Headings, primary content, button text on primary bg |
| Text Secondary | \#A7B6C7 | Body copy, descriptions, secondary labels, inactive nav items |
| Text Muted | \#6F8599 | Placeholders, timestamps, helper text, meta info |

### **Status Colors**

| Status | Background | Text | Usage |
| :---- | :---- | :---- | :---- |
| Draft | rgba(255,255,255,0.06) | \#A7B6C7 | Unpublished, not started |
| In Progress | rgba(19,139,200,0.15) | \#85B7EB | Working on it |
| Ready | rgba(99,153,34,0.18) | \#97C459 | Content/design ready |
| Published | rgba(19,139,200,0.15) | \#85B7EB | Live/posted |
| Pending | rgba(212,169,84,0.15) | \#D4A954 | Waiting for designer |
| Error | rgba(212,117,117,0.08) | \#D47575 | Something went wrong |

### **Borders, Dividers & Effects**

| Token | Value | Usage |
| :---- | :---- | :---- |
| Border | rgba(255,255,255,0.06) | Card borders, input borders, section dividers |
| Border Hover | rgba(255,255,255,0.1) | Input hover state |
| Border Accent | rgba(19,139,200,0.4) | Card hover, selected state border |
| Divider | rgba(255,255,255,0.08) | Section separators, list dividers |
| Shadow Modal | 0 16px 48px rgba(0,0,0,0.5) | Modal/drawer elevation |
| Shadow Toast | 0 4px 16px rgba(0,0,0,0.3) | Toast notification elevation |
| Backdrop | rgba(0,0,0,0.6) | Modal backdrop overlay |

## **9.3 Typography**

| Level | Size | Weight | Line Height | Letter Spacing | Usage |
| :---- | :---- | :---- | :---- | :---- | :---- |
| Display | 48px | 700 | 110% | \-0.5px | Entry page headline only |
| H1 | 32px | 700 | 120% | 0 | Page titles |
| H2 | 24px | 600 | 130% | 0 | Section headers, modal titles |
| H3 | 18px | 600 | 140% | 0 | Card titles, drawer headers |
| Body | 14px | 400 | 160% | 0 | Paragraphs, descriptions |
| Body Large | 16px | 400 | 160% | 0 | Entry page descriptions, important body |
| Label | 12px | 500 | 150% | 0.5px | Form labels, section labels (uppercase) |
| Button | 13px | 600 | 150% | 0 | All button text |
| Caption | 11-12px | 400-500 | 150% | 0 | Timestamps, meta, badge text |

* Font family: Manrope (UI). Fallback: system-ui, \-apple-system, sans-serif.

* Weight discipline: max 2 weights per view. Typically 600 for headings/labels \+ 400 for body.

## **9.4 Spacing Scale**

Use ONLY these values. Never invent others.

Scale: 4 / 8 / 12 / 16 / 24 / 32 / 40 / 48 / 64 / 80 / 96 (px).

* Inside components (padding, gaps): 4-16.

* Between components: 16-24.

* Between sections: 32-48.

* Page-level spacing: 48-96.

## **9.5 Motion Language**

| Property | Value | Usage |
| :---- | :---- | :---- |
| Easing Standard | cubic-bezier(0.2, 0, 0, 1\) | All transitions, hovers, reveals |
| Easing Emphasized | cubic-bezier(0.2, 0, 0, 1.2) | Hero moments only (entry page) |
| Duration XS | 120ms | Icon toggles, tiny feedback |
| Duration S | 160ms | Hover/focus state changes |
| Duration M | 220ms | Dropdowns, panel transitions, card hovers |
| Duration L | 320ms | Modals, drawers, page transitions |
| Translate Distance | 4-12px | Never large slides |

* Hover principle: deepen color, add soft glow/lift — never brighten or bounce.

* No animation on page load for functional elements (instantly interactive).

* Optional: subtle fade-in for entry page elements (staggered 80ms).

# **10\. Component-by-Component Specs**

## **10.1 Buttons**

Global: border-radius 10px. Font: 13px/600. Min height: 44px (mobile), 40px (desktop). Transition: 160ms.

### **Primary (Filled)**

| State | Background | Text | Border | Shadow/Glow |
| :---- | :---- | :---- | :---- | :---- |
| Default | \#138BC8 | \#FFFFFF | none | none |
| Hover | \#0F7EB8 | \#FFFFFF | none | 0 4px 12px rgba(19,139,200,0.2) |
| Active | \#0C5F8A | \#FFFFFF | none | none (translateY \+1px) |
| Disabled | \#1A3A4A | \#6F8599 | none | none |
| Focus | \#138BC8 | \#FFFFFF | none | 0 0 0 3px rgba(19,139,200,0.15) |
| Loading | \#138BC8 | transparent | none | Inline spinner replaces text |

### **Secondary (Outline)**

| State | Background | Text | Border |
| :---- | :---- | :---- | :---- |
| Default | transparent | \#FFFFFF | 1px solid rgba(19,139,200,0.4) |
| Hover | rgba(19,139,200,0.08) | \#FFFFFF | 1px solid rgba(19,139,200,0.6) |
| Active | rgba(19,139,200,0.12) | \#FFFFFF | 1px solid rgba(19,139,200,0.6) |
| Disabled | transparent | \#3A4656 | 1px solid rgba(255,255,255,0.06) |
| Focus | transparent | \#FFFFFF | 1px solid rgba(19,139,200,0.4) |

### **Ghost (Text Only)**

| State | Background | Text | Border |
| :---- | :---- | :---- | :---- |
| Default | transparent | \#A7B6C7 | none |
| Hover | rgba(255,255,255,0.04) | \#FFFFFF | none |
| Active | rgba(255,255,255,0.08) | \#FFFFFF | none |
| Disabled | transparent | \#3A4656 | none |
| Focus | transparent | \#A7B6C7 | none |

### **Icon-Only**

| State | Background | Icon Color | Size |
| :---- | :---- | :---- | :---- |
| Default | transparent | \#A7B6C7 | 40px square |
| Hover | rgba(255,255,255,0.06) | \#FFFFFF | 40px square |
| Active | rgba(255,255,255,0.1) | \#FFFFFF | 40px square |
| Disabled | transparent | \#3A4656 | 40px square |
| Focus | transparent | \#A7B6C7 | 40px square |

* Icon size: 20px. Border-radius: 8px.

## **10.2 Inputs**

| State | Background | Text | Border | Notes |
| :---- | :---- | :---- | :---- | :---- |
| Default | \#00162E | \#FFFFFF | 1px solid rgba(255,255,255,0.06) | Placeholder: \#6F8599 |
| Hover | \#00162E | \#FFFFFF | 1px solid rgba(255,255,255,0.1) | Slightly stronger border |
| Focus | \#00162E | \#FFFFFF | 1px solid rgba(19,139,200,0.6) | Glow: 0 0 0 3px rgba(19,139,200,0.15) |
| Error | \#00162E | \#FFFFFF | 1px solid \#8B4040 | Error text: 12px/\#D47575 below |
| Disabled | \#001224 | \#6F8599 | 1px solid rgba(255,255,255,0.04) | No interaction |

* Height: 44px. Border-radius: 10px. Padding: 0 14px. Font: 14px/400.

* Label: 12px/500/\#A7B6C7, above field, margin-bottom 6px. Required: red asterisk \* (12px/\#D47575).

* Textarea: same styling, min-height 80px, padding 12px 14px, resize vertical.

* Select: same styling \+ dropdown arrow icon (16px, \#6F8599) on right.

## **10.3 Cards**

| State | Background | Border | Shadow | Transform |
| :---- | :---- | :---- | :---- | :---- |
| Default | \#00162E | 1px solid rgba(255,255,255,0.06) | none | none |
| Hover | \#001F3D | 1px solid rgba(19,139,200,0.4) | 0 4px 12px rgba(0,0,0,0.2) | translateY(-2px) |
| Selected | \#001F3D | 1px solid rgba(19,139,200,0.6) | 0 0 0 3px rgba(19,139,200,0.15) | none |
| Focused | \#001F3D | 1px solid rgba(19,139,200,0.4) | 0 0 0 3px rgba(19,139,200,0.15) | none |

* Border-radius: 12px. Padding: 16px. Transition: all 220ms.

## **10.4 Chips / Tags / Badges**

* Border-radius: 999px (pill). Padding: 3px 10px. Font: 11px/500.

* Status chips use the Status Colors defined in section 9.2.

* Platform chips: bg rgba(19,139,200,0.15), text \#85B7EB.

* Content type chips: bg rgba(255,255,255,0.06), text \#A7B6C7.

## **10.5 Calendar Components**

### **Mini Card (Month View)**

* Background: Surface 1\. Border-radius: 4px. Padding: 3px 6px.

* Platform icon: 12px, left. Title: 11px/\#FFFFFF, truncated.

* Design dot: 4px circle, \#138BC8, absolute right.

### **Calendar Card (Week/Day View)**

* Background: Surface 1\. Border: 1px solid rgba(255,255,255,0.06). Border-radius: 8px. Padding: 12px.

* Time: 11px/\#6F8599. Platform: 11px/\#A7B6C7. Title: 13px/500/\#FFFFFF.

* Content type badge: 10px pill. Design status badge: 10px pill (color per status).

* Hover: Surface 2 bg, accent border, lift 2px, glow.

### **Timeline Dot**

* Size: 10px circle. Color: \#138BC8. Border: 2px solid \#000D20.

* Positioned on the vertical timeline line.

## **10.6 Modals & Drawers**

### **Modal**

* Backdrop: rgba(0,0,0,0.6), backdrop-filter blur(4px).

* Container: Surface 2, border-radius 16px, max-width 560px, max-height 90vh.

* Border: 1px solid rgba(255,255,255,0.06). Shadow: 0 16px 48px rgba(0,0,0,0.5).

* Overflow: auto. Padding: 32px.

* Open: fade \+ scale 0.98 to 1, 320ms. Close: reverse 220ms.

### **Drawer (Right Side)**

* Width: 420px. Height: 100vh. Background: Surface 2\.

* Border-left: 1px solid rgba(255,255,255,0.06). Shadow: \-8px 0 24px rgba(0,0,0,0.3).

* Open: translateX(100%) to 0, 320ms. Close: reverse 220ms.

### **Bottom Sheet (Mobile)**

* Full width, max-height 90vh, border-radius 16px 16px 0 0\.

* Drag handle: 40x4px, \#6F8599, rounded, centered top.

* Open: translateY(100%) to 0, 320ms. Close: swipe down or backdrop tap.

## **10.7 Toasts & Banners**

* Toast: max-width 400px. Position: bottom-right desktop, top-center mobile.

* Background: Surface 2\. Border-left: 3px solid \#138BC8 (info), \#97C459 (success), \#D47575 (error).

* Border-radius: 8px. Padding: 12px 16px. Shadow: 0 4px 16px rgba(0,0,0,0.3).

* Auto-dismiss: 4 seconds. Progress bar at bottom (thin, fades over 4s).

* Manual close: X button, icon-only ghost, 16px.

* Stacking: max 3 visible, newer pushes older up.

## **10.8 Segmented Control (View Toggle)**

* Container: bg rgba(255,255,255,0.04), border-radius 8px, padding 3px.

* Segment: 13px/500/\#A7B6C7, padding 6px 16px, border-radius 8px.

* Active segment: bg Surface 2, text \#FFFFFF.

* Transition: background 160ms, color 160ms.

## **10.9 Progress Steps**

* Horizontal layout. Each step: circle (24px) \+ label below (12px).

* Step circle: border 2px. Active: border \#138BC8, bg \#000D20, text \#138BC8. Completed: bg \#138BC8, text \#FFFFFF, checkmark icon. Future: border \#6F8599, bg transparent, text \#6F8599.

* Connector line between steps: 2px height. Completed: \#138BC8. Future: rgba(255,255,255,0.06).

* Used in Create Brand form (3 steps).

# **11\. Responsiveness Specification**

## **11.1 Breakpoints**

| Breakpoint | Range | Key Behavior |
| :---- | :---- | :---- |
| Mobile | \<= 480px | Single column, drawer nav, stacked CTAs, full-width inputs, bottom sheets |
| Tablet | 481-768px | 2-column layouts, collapsible sidebar, modals instead of drawers |
| Desktop | \>= 769px | Full multi-column, fixed sidebar, max-width 1280px centered |

## **11.2 Layout Rules by Breakpoint**

### **Navigation**

* Mobile: sidebar becomes drawer (280px, slides from left). Hamburger toggle in top bar. No collapse feature.

* Tablet: sidebar visible, collapsible to 72px. Drawer only if explicitly toggled.

* Desktop: sidebar fixed at 240px, collapsible to 72px.

### **Entry Page**

* Mobile: single column, stacked. Headline 36px. CTAs full-width stacked. Visual 180px max.

* Tablet: two columns, 50/50 split. Headline 42px.

* Desktop: two columns, 55/45 split. Headline 48px.

### **Auth Card**

* Mobile: full width minus 32px padding. No border-radius on card (full-bleed). Max-width none.

* Tablet+: centered card, 420px max-width, 16px border-radius.

### **Strategy Workspace**

* Mobile: no left panel, no right panel. Full-width chat only. Strategy history accessible via dropdown at top. Strategy preview shown as inline card in chat.

* Tablet: chat \+ collapsible right panel. Left panel hidden.

* Desktop: left panel (280px) \+ chat (flex) \+ right panel (320px, collapsible).

### **Calendar**

* Mobile: Month view \= compact grid, tap day opens Day view. Week view hidden on mobile (replaced by Day). Agenda view always available.

* Tablet+: all views available. Week view shows 7 columns.

### **Calendar Item Detail**

* Mobile: bottom sheet (slides up, max-height 90vh).

* Desktop: right-side drawer (420px).

### **Design Request**

* Mobile: bottom sheet.

* Desktop: centered modal (560px max-width).

## **11.3 Touch & Interaction Rules**

* All tap targets minimum 44px on mobile.

* No hover-dependent interactions on mobile (no hover states, use tap/active instead).

* Swipe gestures: left sidebar drawer closes on swipe left. Bottom sheets close on swipe down.

* Long-press: not used in MVP (keep simple).

* Pull-to-refresh: not needed (auto-refresh on navigation).

## **11.4 Typography Scaling**

| Element | Desktop | Tablet | Mobile |
| :---- | :---- | :---- | :---- |
| Display (Entry headline) | 48px | 42px | 36px |
| H1 (Page title) | 32px | 28px | 24px |
| H2 (Section title) | 24px | 22px | 20px |
| Body | 14px | 14px | 15px (slightly larger for readability) |
| Button | 13px | 13px | 14px |
| Caption/Meta | 11-12px | 11-12px | 12px |

## **11.5 Spacing Scaling**

| Context | Desktop | Mobile |
| :---- | :---- | :---- |
| Page padding | 24px | 16px |
| Card padding | 16px | 12px |
| Section gap | 32px | 24px |
| Button height | 40-44px | 48-52px (larger touch targets) |
| Input height | 44px | 48px |

## **11.6 QA Checklist**

* No overlap between sidebar and content at any breakpoint.

* All forms scroll properly within their containers on all screen sizes.

* Primary CTA visible above fold on mobile entry page.

* Drawer closes properly — no content blocking, backdrop dismiss works.

* All tap targets \>= 44px on mobile.

* No horizontal scroll on mobile (vertical scroll only).

* Body text never below 14px on any device.

* Images scale proportionally (no distortion).

* Auth forms centered and readable on all devices.

* Loading states visible and accessible on slow connections.

* Error states visible without scrolling.

* Focus states visible for keyboard navigation (tab order logical).

* WCAG AA color contrast met on all surfaces.

* Bottom sheets can be dismissed by swipe, backdrop tap, and close button.

* Modal does not cause background scroll lock issues on iOS.

* Calendar grid does not break on narrow screens (min 320px width).

# **12\. Accessibility Requirements**

## **12.1 Contrast**

* All text must meet WCAG AA contrast ratios (4.5:1 for normal text, 3:1 for large text).

* \#FFFFFF on \#000D20 \= 21:1 (passes). \#FFFFFF on \#00162E \= 18.5:1 (passes).

* \#A7B6C7 on \#000D20 \= 9.2:1 (passes). \#6F8599 on \#000D20 \= 5.8:1 (passes).

* \#138BC8 on \#000D20 \= 5.1:1 (passes for large text, borderline for normal).

## **12.2 Focus Management**

* All interactive elements must have visible focus states.

* Focus indicator: KO Blue glow ring (0 0 0 3px rgba(19,139,200,0.15)) for buttons, inputs, links.

* Never rely on color alone for focus — the glow ring provides visibility.

* Tab order: logical, top-to-bottom, left-to-right.

* Trap focus within modals/drawers when open (Tab cycles within, Escape closes).

* Return focus to trigger element when modal/drawer closes.

## **12.3 Screen Readers**

* All icon-only buttons have aria-label (e.g., aria-label=Close sidebar).

* Modal: role=dialog, aria-modal=true, aria-labelledby pointing to title.

* Form inputs: associated label via htmlFor \+ id.

* Error messages: aria-describedby on input pointing to error text.

* Live regions: aria-live=polite for AI responses, toast notifications, status updates.

* Navigation: nav element with aria-label=Main navigation. Current page: aria-current=page.

## **12.4 Form Accessibility**

* Required fields: marked with visible red asterisk \+ aria-required=true.

* Error messages: shown inline, in plain language, never color-only.

* Password field: show/hide toggle has aria-label=Show password / Hide password.

* Select dropdowns: keyboard navigable (arrow keys, Enter to select, Escape to close).

## **12.5 Motion & Animation**

* Respect prefers-reduced-motion: if user has this setting enabled, disable all animations (instant transitions).

* No auto-playing animations that cannot be paused (the entry page visual is subtle and ambient — acceptable).

* No flashing or strobing effects.

# **13\. Key Terminology**

| Term | Definition |
| :---- | :---- |
| Brand Profile | The user's business information stored in KO OS — name, overview, audience, tone, logo, colors |
| Content Strategy | The AI-generated plan: campaign overview, channels, content mix, timeline, themes |
| Content Calendar | The day-by-day schedule of content tasks generated from the strategy |
| Calendar Item | A single task in the calendar: one post, one email, one blog entry for a specific day/time |
| Design Ticket | A request sent to KO's human design team to create a visual asset |
| Design Request | The form the user fills out to create a Design Ticket |
| Strategy Session | One complete AI chat conversation that results in a strategy |
| Campaign | The overall marketing initiative (e.g., The Fresh Drop product launch) |

**KO OS**

Your Brand Brain — powered by KO.

Version 1.1  |  June 2026

Confidential — Internal Use Only