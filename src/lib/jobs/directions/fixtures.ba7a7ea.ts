/* Eval run a at ba7a7ea (/tmp/feat-033/u3-r6/eval-a-ba7a7ea-report.json),
   copied as logged: per case the brief, the model's drafts, the brief
   read, the first claim check's headline flag and the candidates the
   recovery ask wrote. Job tests replay them with every model call stubbed
   to return what was logged. Where the log shows the second design's copy
   at recovery differing from its draft (a redraft or the fit pass moved
   it), atRecovery holds that copy: the "from" of the footer merge the job
   logs after recovery (eval-a-ba7a7ea.log lines 191 and 463). */
export const EVAL_A_BA7A7EA = {
  "conference-ko": {
    briefText:
      "Announce our panel 'Building for Heat' with architect Ada Obi, Friday 14 March at 4pm, Landmark Centre. Free registration, limited seats.",
    title: "Panel announcement",
    brandSummary: {
      name: "Lagos Design Week",
      overview: "Annual festival of African design and architecture.",
      tone: "Curious, bold, editorial",
      primaryColor: "#111111",
      secondaryColor: "#F59E0B",
    },
    drafts: [
      {
        layout: "hero-center",
        headline: "Building for Heat",
        subheadline: "A panel with architect Ada Obi on designing for climate.",
        cta: "Register Free",
        footerStyle: "bar",
        footerLines: [
          "Friday 14 March · 4pm",
          "Landmark Centre",
          "Seats are limited",
        ],
        palette: {
          background: "#111111",
          foreground: "#F5F5F5",
          accent: "#F59E0B",
        },
        logoPlacement: "top-left",
        logoFree: false,
        logoFreeQuote: "",
        backgroundPrompt: "Deep black ground, uniform and matte",
        backgroundTreatment: "solid",
        nativePrompt:
          'Square social post on a deep black (#111111) ground. Centred stack layout. At the top, the Lagos Design Week logo composited top-left. Centre of the frame: headline in large, bold amber (#F59E0B) sans-serif capitals — "Building for Heat". Below it, a white (#F5F5F5) subheadline in medium weight — "A panel with architect Ada Obi on designing for climate." Below that, an amber pill button with black text — "Register Free". At the bottom, a solid black footer bar with three white lines: "Friday 14 March · 4pm" / "Landmark Centre" / "Seats are limited".',
        aspectRatio: "1:1",
        title: "Event name leads",
        rationale: [
          "The headline quotes the panel title 'Building for Heat' exactly.",
          "Architect Ada Obi is named in the subheadline as the speaker.",
          "The footer carries Friday 14 March, 4pm and Landmark Centre.",
          "Free registration and limited seats appear in the CTA and footer.",
        ],
        productName: "",
        productLook: "",
      },
      {
        layout: "quote-card",
        headline: "Can buildings fight the heat?",
        subheadline:
          "Ada Obi answers at Lagos Design Week's 'Building for Heat' panel.",
        cta: "Free Registration",
        footerStyle: "text",
        footerLines: [
          "Friday 14 March · 4pm",
          "Landmark Centre · Seats limited",
        ],
        palette: {
          background: "#F59E0B",
          foreground: "#111111",
          accent: "#111111",
        },
        logoPlacement: "top-right",
        logoFree: false,
        logoFreeQuote: "",
        backgroundPrompt: "Warm amber ground, flat and even",
        backgroundTreatment: "solid",
        nativePrompt:
          'Square social post on a warm amber (#F59E0B) ground. Quote-card layout. Lagos Design Week logo composited top-right. A large editorial question in bold black (#111111) sans-serif — "Can buildings fight the heat?" — centred and taking up most of the vertical space. Below it, a smaller black subheadline — "Ada Obi answers at Lagos Design Week\'s \'Building for Heat\' panel." Then a black outlined button with black text — "Free Registration". Near the bottom, two plain black text lines — "Friday 14 March · 4pm" and "Landmark Centre · Seats limited".',
        aspectRatio: "1:1",
        title: "Heat as the hook",
        rationale: [
          "The headline poses the climate question the panel 'Building for Heat' addresses.",
          "Ada Obi is named in the subheadline as the voice answering that question.",
          "Friday 14 March, 4pm and Landmark Centre appear in the footer lines.",
          "Free registration and limited seats are both carried in the CTA and footer.",
        ],
        productName: "",
        productLook: "",
      },
    ],
    read: {
      facts: [
        {
          kind: "date",
          text: "Friday 14 March",
        },
        {
          kind: "time",
          text: "at 4pm",
        },
        {
          kind: "place",
          text: "Landmark Centre",
        },
        {
          kind: "price",
          text: "Free registration",
        },
        {
          kind: "quantity",
          text: "limited seats",
        },
      ],
      offering: {
        kind: "event",
        phrase: "Building for Heat",
      },
      people: ["Ada Obi"],
    },
    headlineFlag: {
      id: "1.headline",
      statement: "Design for a Hotter World",
      rewrite: "Building for Heat",
    },
    atRecovery: {
      title: "Heat as provocation",
      headline: "Design for a Hotter World",
      subheadline:
        "Ada Obi joins Building for Heat, a panel at Lagos Design Week.",
      cta: "Reserve Your Seat",
    },
    candidates: [
      "Free Panel on Heat-Resilient Design",
      "A Panel on Designing for Heat",
      "Free Registration, Limited Seats",
    ],
  },
  "recruitment-ko": {
    briefText:
      "We're hiring two senior React engineers, fully remote anywhere in Africa. Apply by 30 November.",
    title: "Senior React engineers",
    brandSummary: {
      name: "Paystack-style Labs",
      overview: "Payments infrastructure company with engineers across Africa.",
      tone: "Direct, warm, ambitious",
      primaryColor: "#0F172A",
      secondaryColor: "#38BDF8",
    },
    drafts: [
      {
        layout: "hero-center",
        headline: "Senior React Engineers Wanted",
        subheadline:
          "Fully remote across Africa. Join a payments infrastructure team built for scale.",
        cta: "Apply by 30 Nov",
        footerStyle: "bar",
        footerLines: [
          "[APPLICATION URL]",
          "Deadline: 30 November",
          "Remote — Africa",
        ],
        palette: {
          background: "#0F172A",
          foreground: "#F8FAFC",
          accent: "#38BDF8",
        },
        logoPlacement: "none",
        logoFree: true,
        logoFreeQuote: "",
        backgroundPrompt: "Deep navy solid ground, no imagery",
        backgroundTreatment: "solid",
        nativePrompt:
          'A 1200x1200 LinkedIn post on a deep navy (#0F172A) background. Centred layout. At the top, a sky-blue (#38BDF8) label in small caps: "PAYSTACK-STYLE LABS". Below it, a large white bold headline: "Senior React Engineers Wanted". Below that, a white subheadline at medium weight: "Fully remote across Africa. Join a payments infrastructure team built for scale." A sky-blue pill button: "Apply by 30 Nov". Footer bar in sky-blue: "[APPLICATION URL]  ·  Deadline: 30 November  ·  Remote — Africa"',
        aspectRatio: "1:1",
        title: "Remote role call",
        rationale: [
          "The headline names the role — Senior React Engineers — directly.",
          "The subheadline states the fully remote Africa location from the brief.",
          "The CTA carries the 30 November deadline so applicants act in time.",
          "Paystack-style Labs is named as the hiring organisation above the headline.",
        ],
        productName: "",
        productLook: "",
      },
      {
        layout: "stat-highlight",
        headline: "Build Africa's Payment Rails",
        subheadline:
          "We're hiring senior React engineers, fully remote. Apply before 30 November.",
        cta: "See the role",
        footerStyle: "text",
        footerLines: [
          "[APPLICATION URL]",
          "Deadline: 30 November",
          "Remote — Africa",
        ],
        palette: {
          background: "#38BDF8",
          foreground: "#0F172A",
          accent: "#0F172A",
        },
        logoPlacement: "none",
        logoFree: true,
        logoFreeQuote: "",
        backgroundPrompt: "Bright sky-blue solid ground, no imagery",
        backgroundTreatment: "solid",
        nativePrompt:
          'A 1200x1200 LinkedIn post on a sky-blue (#38BDF8) background. Stat-highlight layout. In the upper area, a small dark navy (#0F172A) label in caps: "PAYSTACK-STYLE LABS — WE\'RE HIRING". Below it, a very large, bold navy headline spanning the width: "Build Africa\'s Payment Rails". Below that, a navy medium-weight subheadline: "We\'re hiring senior React engineers, fully remote. Apply before 30 November." A dark navy outlined button with navy text: "See the role". At the bottom, a clean navy text footer: "[APPLICATION URL]  ·  Deadline: 30 November  ·  Remote — Africa"',
        aspectRatio: "1:1",
        title: "Infrastructure ambition",
        rationale: [
          "The headline leads with Paystack-style Labs' mission to anchor the brand voice.",
          "The subheadline names the Senior React Engineer role and the Africa-remote detail.",
          "The 30 November deadline appears in both the subheadline and the footer.",
          "The footer carries the application URL so candidates know where to go.",
        ],
        productName: "",
        productLook: "",
      },
    ],
    read: {
      facts: [
        {
          kind: "quantity",
          text: "two senior React engineers",
        },
        {
          kind: "place",
          text: "fully remote anywhere in Africa",
        },
        {
          kind: "date",
          text: "30 November",
        },
      ],
      offering: {
        kind: "service",
        phrase: "senior React engineers",
      },
      people: [],
    },
    headlineFlag: {
      id: "1.headline",
      statement: "Build Africa's Payment Rails",
      rewrite: "Senior React Engineers Wanted",
    },
    candidates: [
      "Senior React Engineers, Remote in Africa",
      "Remote React Roles Across Africa",
      "React Engineers Across Africa",
    ],
  },
  "fashion-portrait-upload": {
    briefText:
      "Pre-orders open for the Harmattan linen dress, ₦38,000, from Friday 1 November on adirehouse.ng.",
    title: "Harmattan dress pre-order",
    brandSummary: {
      name: "Adire House",
      overview: "Contemporary adire womenswear studio in Ikoyi, Lagos.",
      targetAudience: "Women who dress for work and weekends in one wardrobe",
      tone: "Assured, warm, unhurried",
      primaryColor: "#F5F0E6",
      secondaryColor: "#1E3A8A",
    },
    drafts: [
      {
        layout: "banner-bottom",
        headline: "The Harmattan Linen Dress",
        subheadline: "Pre-orders open Friday 1 November at adirehouse.ng",
        cta: "Pre-order Now",
        footerStyle: "bar",
        footerLines: [
          "Pre-orders from Friday 1 November",
          "₦38,000 — adirehouse.ng",
        ],
        palette: {
          background: "#F5F0E6",
          foreground: "#1E3A8A",
          accent: "#F5F0E6",
        },
        logoPlacement: "none",
        logoFree: true,
        logoFreeQuote: "",
        backgroundPrompt:
          "A woman in a flowing sage-green linen robe and wide woven conical hat, holding a small fan, standing beside a weathered stone pillar with soft garden greenery and a traditional tiled roof in the background",
        backgroundTreatment: "photographic",
        nativePrompt:
          '4:5 Instagram post. The supplied photograph fills the full frame — a woman in a flowing sage-green linen robe and wide conical hat, standing beside a stone pillar, garden foliage around her. A solid navy (#1E3A8A) banner sits across the bottom quarter of the image. Inside the banner, left-aligned in cream (#F5F0E6) serif type: headline "The Harmattan Linen Dress" in large weight, below it subheadline "Pre-orders open Friday 1 November at adirehouse.ng" in smaller weight, and to the right a cream-outlined pill button reading "Pre-order Now" in navy. The banner is opaque so text reads cleanly over the photograph. No logo.',
        aspectRatio: "4:5",
        title: "The dress, named",
        rationale: [
          "The headline names the Harmattan linen dress directly.",
          "The footer carries the ₦38,000 price and Friday 1 November date.",
          "The subheadline points to adirehouse.ng so the order destination is clear.",
          "The CTA tells the customer the next action: pre-order.",
        ],
        productName: "Harmattan linen dress",
        productLook:
          "A floor-length or midi-length dress in textured linen, structured yet relaxed in silhouette, with wide sleeves and a natural drape — worn here in sage green with visible fabric texture and generous volume through the body.",
      },
      {
        layout: "hero-center",
        headline: "Dressed for the dry season",
        subheadline:
          "The Harmattan linen dress. ₦38,000. Pre-orders open 1 November.",
        cta: "Shop the Drop",
        footerStyle: "none",
        footerLines: [],
        palette: {
          background: "#1E3A8A",
          foreground: "#F5F0E6",
          accent: "#F5F0E6",
        },
        logoPlacement: "none",
        logoFree: true,
        logoFreeQuote: "",
        backgroundPrompt:
          "A woman in a flowing sage-green linen robe and wide woven conical hat, holding a small fan, standing beside a weathered stone pillar with soft garden greenery and a traditional tiled roof in the background",
        backgroundTreatment: "photographic",
        nativePrompt:
          '4:5 Instagram post. The supplied photograph fills the frame — a woman in a flowing sage-green linen robe and wide conical hat beside a stone pillar with garden greenery. A deep navy (#1E3A8A) colour wash at 55% opacity covers the entire image, darkening it enough for cream text to read cleanly. All copy is centred. At the top third: headline "Dressed for the dry season" in large cream (#F5F0E6) serif type. Below it: subheadline "The Harmattan linen dress. ₦38,000. Pre-orders open 1 November." in smaller cream weight. Near the bottom: a cream-filled pill button with navy text reading "Shop the Drop". No logo.',
        aspectRatio: "4:5",
        title: "Season, not product",
        rationale: [
          "The headline ties the Harmattan linen dress to its season in the brand's voice.",
          "The subheadline states the ₦38,000 price and the 1 November pre-order date.",
          "The CTA moves the customer toward adirehouse.ng to complete the pre-order.",
          "The photograph of the linen garment supports the dry-season line without competing with it.",
        ],
        productName: "Harmattan linen dress",
        productLook:
          "A floor-length or midi-length dress in textured linen, structured yet relaxed in silhouette, with wide sleeves and a natural drape — worn here in sage green with visible fabric texture and generous volume through the body.",
      },
    ],
    read: {
      facts: [
        {
          kind: "condition",
          text: "Pre-orders open",
        },
        {
          kind: "price",
          text: "₦38,000",
        },
        {
          kind: "day",
          text: "Friday",
        },
        {
          kind: "date",
          text: "1 November",
        },
        {
          kind: "contact",
          text: "adirehouse.ng",
        },
      ],
      offering: {
        kind: "product",
        phrase: "Harmattan linen dress",
      },
      people: [],
    },
    headlineFlag: {
      id: "1.headline",
      statement: "Dressed for the dry season",
      rewrite: "The Harmattan Linen Dress",
    },
    candidates: [
      "Pre-orders open for the Harmattan dress",
      "Harmattan dress pre-orders now open",
      "Pre-order the Harmattan dress",
    ],
  },
  "storefront-reopening-upload": {
    briefText:
      "Our fabric shop reopens on Saturday 6 December. Ankara from ₦6,500 a yard and lace bundles at ₦38,000 for 5 yards. Shop 12, Balogun Market, Lagos Island, open 9am to 5pm. Call 0802 333 4567.",
    title: "Shop reopening",
    brandSummary: {
      name: "Iya Basira Fabrics",
      overview: "Ankara and lace fabric shop in Balogun Market, Lagos Island.",
      targetAudience: "Tailors and families shopping for occasions",
      tone: "Bright, generous, straight to the point",
      primaryColor: "#FFFBEB",
      secondaryColor: "#B91C1C",
    },
    drafts: [
      {
        layout: "banner-bottom",
        headline: "We're Back. Ankara & Lace.",
        subheadline:
          "Ankara from ₦6,500 a yard. Lace bundles at ₦38,000 for 5 yards.",
        cta: "Visit Us Saturday",
        footerStyle: "bar",
        footerLines: [
          "Sat 6 Dec · 9am–5pm",
          "Shop 12, Balogun Market, Lagos Island",
          "0802 333 4567",
        ],
        palette: {
          background: "#FFFBEB",
          foreground: "#B91C1C",
          accent: "#FFFBEB",
        },
        logoPlacement: "none",
        logoFree: true,
        logoFreeQuote: "",
        backgroundPrompt:
          "A corner market street with a multi-storey ornate white building, flower-adorned balconies, and a pedestrian crossing in the foreground",
        backgroundTreatment: "photographic",
        nativePrompt:
          '4:5 Instagram post for Iya Basira Fabrics. The photograph of the ornate white corner building fills the full frame. A bold dark-red (#B91C1C) banner bar sits across the lower third of the image. Inside the bar, centred, in large cream (#FFFBEB) bold sans-serif type: "We\'re Back. Ankara & Lace." Below in smaller cream type: "Ankara from ₦6,500 a yard. Lace bundles at ₦38,000 for 5 yards." A cream pill button reads "Visit Us Saturday". A compact cream footer line at the very bottom reads: "Sat 6 Dec · 9am–5pm · Shop 12, Balogun Market, Lagos Island · 0802 333 4567".',
        aspectRatio: "4:5",
        title: "Fabric shop returns",
        rationale: [
          "The headline names the two products — Ankara and lace — directly.",
          "The subheadline gives both prices from the brief: ₦6,500 a yard and ₦38,000 for 5 yards.",
          "Saturday 6 December and 9am–5pm opening hours appear in the footer.",
          "Shop 12, Balogun Market and 0802 333 4567 are in the footer so shoppers can act immediately.",
        ],
        productName: "Ankara fabric, lace fabric",
        productLook:
          "Ankara: tightly woven cotton fabric in bold geometric and floral prints, vivid colours (royal blue, orange, green, red), sold off the bolt by the yard. Lace: semi-sheer fabric with raised floral or vine patterns, usually ivory, champagne or white, sold in bundled lengths.",
      },
      {
        layout: "hero-center",
        headline: "Your Fabrics Are Waiting",
        subheadline:
          "Ankara from ₦6,500/yard · Lace bundles ₦38,000 for 5 yards. Open Saturday 6 December.",
        cta: "Come In Saturday",
        footerStyle: "text",
        footerLines: [
          "Shop 12, Balogun Market, Lagos Island",
          "9am–5pm · 0802 333 4567",
        ],
        palette: {
          background: "#B91C1C",
          foreground: "#FFFBEB",
          accent: "#FFFBEB",
        },
        logoPlacement: "none",
        logoFree: true,
        logoFreeQuote: "",
        backgroundPrompt:
          "A corner market street with a multi-storey ornate white building, flower-adorned balconies, and a pedestrian crossing in the foreground",
        backgroundTreatment: "photographic",
        nativePrompt:
          '4:5 Instagram post for Iya Basira Fabrics. The photograph of the ornate white corner building fills the full frame with a strong dark-red (#B91C1C) colour overlay at 70% opacity to unite the image under the brand colour. All copy is centred in the middle of the frame in cream (#FFFBEB). Large bold serif headline: "Your Fabrics Are Waiting". Below it in medium weight sans-serif: "Ankara from ₦6,500/yard · Lace bundles ₦38,000 for 5 yards. Open Saturday 6 December.". A cream outlined pill button reads "Come In Saturday". At the very bottom, a slim cream text footer: "Shop 12, Balogun Market, Lagos Island · 9am–5pm · 0802 333 4567".',
        aspectRatio: "4:5",
        title: "Doors open Saturday",
        rationale: [
          "The headline speaks directly to tailors and families shopping for occasions.",
          "The subheadline carries both prices — ₦6,500 a yard and ₦38,000 for 5 yards — and Saturday 6 December.",
          "The CTA names Saturday so the reopening date is reinforced in the action prompt.",
          "Shop 12, Balogun Market, 9am–5pm and 0802 333 4567 are all present so no visit detail is missing.",
        ],
        productName: "Ankara fabric, lace fabric",
        productLook:
          "Ankara: tightly woven cotton fabric in bold geometric and floral prints, vivid colours (royal blue, orange, green, red), sold off the bolt by the yard. Lace: semi-sheer fabric with raised floral or vine patterns, usually ivory, champagne or white, sold in bundled lengths.",
      },
    ],
    read: {
      facts: [
        {
          kind: "date",
          text: "Saturday 6 December",
        },
        {
          kind: "price",
          text: "₦6,500 a yard",
        },
        {
          kind: "price",
          text: "₦38,000 for 5 yards",
        },
        {
          kind: "place",
          text: "Shop 12, Balogun Market, Lagos Island",
        },
        {
          kind: "time",
          text: "9am to 5pm",
        },
        {
          kind: "contact",
          text: "Call 0802 333 4567",
        },
      ],
      offering: {
        kind: "event",
        phrase: "reopens",
      },
      people: [],
    },
    headlineFlag: {
      id: "1.headline",
      statement: "Your Fabrics Are Waiting",
      rewrite: "We're Back. Ankara & Lace.",
    },
    atRecovery: {
      subheadline:
        "Iya Basira Fabrics reopens Saturday 6 December. Ankara ₦6,500 a yard, lace bundles ₦38,000 for 5 yards.",
    },
    candidates: [
      "Doors Open Saturday 6 December",
      "Iya Basira Fabrics Is Reopening",
      "The Shop Reopens This Saturday",
    ],
  },
} as const;
