/**
 * Blog content — authored here, in code, rather than a CMS.
 *
 * The site has no editor yet and no publishing cadence to justify one;
 * a typed module gives us localized posts, static rendering, and the
 * same review path as every other change. Every claim in these posts is
 * true of the shipped product (model names, credit rules, tool behaviour)
 * — they read as product notes, not marketing fiction. Move to a CMS when
 * someone other than an engineer needs to publish.
 *
 * `body` is a list of blocks so the renderer controls typography and
 * neither locale can smuggle in markup.
 */

import type { Locale } from "@/i18n/routing";

export type BlogBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "quote"; text: string };

export interface BlogPostContent {
  title: string;
  /** One-sentence standfirst, also the meta description. */
  excerpt: string;
  body: BlogBlock[];
}

export interface BlogPost {
  slug: string;
  /** ISO date, shown formatted per locale. */
  date: string;
  /** Topic label key in the `blog` namespace (`tag*`). */
  tag: "product" | "guide" | "models";
  /** Minutes, computed once here from the English word count. */
  readMinutes: number;
  /** Which studio surface the post's CTA opens. */
  cta: { href: "/create" | "/create-video" | "/create?tool=camera" | "/create?tool=storyboard" | "/pricing" };
  /** Accent used on the card and the article header. */
  accent: "green" | "purple" | "turquoise" | "gold";
  content: Record<Locale, BlogPostContent>;
}

export const BLOG_POSTS: readonly BlogPost[] = [
  {
    slug: "how-credits-work",
    date: "2026-09-01",
    tag: "guide",
    readMinutes: 4,
    cta: { href: "/pricing" },
    accent: "gold",
    content: {
      en: {
        title: "How credits work at Clickefy",
        excerpt:
          "One balance for every model, the price shown before you generate, and refunds when a job fails on our side. Here is exactly how the credit system behaves.",
        body: [
          {
            type: "p",
            text: "Every model in the studio, image or video, is priced in the same unit: credits. You see the cost on the Generate button before you press it, the balance is debited when the job starts, and if the job fails because of a provider or infrastructure error the credits come back on their own. That is the whole system, but the details matter, so here they are.",
          },
          { type: "h2", text: "Three kinds of credits, one balance" },
          {
            type: "p",
            text: "Your balance is the sum of three buckets. Plan credits arrive with every billing period and reset at the start of the next one. Top-up credits are the packs you buy on top of a plan, and they last twelve months. Promo credits are the ones we grant, like the welcome credits every new account gets, and those never expire.",
          },
          {
            type: "ul",
            items: [
              "Plan credits are spent first, so nothing you paid for extra is touched until the monthly allowance is gone.",
              "Top-up credits are spent next. They can only be used while a plan is active, and their twelve-month clock pauses whenever you have no active plan, so a gap in your subscription never costs you time you did not use.",
              "Promo credits are spent last and never expire.",
            ],
          },
          { type: "h2", text: "What a generation costs" },
          {
            type: "p",
            text: "Image models have a flat price per generation, adjusted for the quality tier you pick. Video models bill per second of output: the price you see is for the default clip length at the selected resolution, and it scales with the duration you choose. Native audio costs more on the models that charge for it, and reference video adds a per-second term because the provider processes those frames too. The button always shows the final number, computed with the same code the server bills with.",
          },
          { type: "h2", text: "When credits come back" },
          {
            type: "p",
            text: "If a job fails for a reason that is ours or the model provider's, a timeout, an outage, a rejected request, the debit is reversed automatically and your balance updates within seconds. A failure caused by the input itself, such as content the provider's safety filter refuses, is treated the same way. What is not refunded is a generation that completed but did not turn out the way you hoped; the provider has been paid for that render.",
          },
          { type: "h2", text: "Why the app costs more than the web" },
          {
            type: "p",
            text: "Apple and Google take a share of every purchase made inside an app. Subscribing on the web avoids that cut, which is why the same plan is cheaper here. Your credits are the same wherever you bought them: sign in on the web with the account you use in the app and the balance is there.",
          },
        ],
      },
      ar: {
        title: "كيف تعمل النقاط في Clickefy",
        excerpt:
          "رصيد واحد لكل النماذج، والسعر ظاهر قبل التوليد، واسترجاع تلقائي عند فشل المهمة من جهتنا. هكذا يعمل نظام النقاط بالتفصيل.",
        body: [
          {
            type: "p",
            text: "كل نموذج في الاستوديو، صورةً كان أو فيديو، مسعّر بنفس الوحدة: النقاط. ترى التكلفة على زر التوليد قبل الضغط عليه، ويُخصم الرصيد عند بدء المهمة، وإذا فشلت المهمة بسبب خطأ من مزوّد النموذج أو من بنيتنا التقنية تعود النقاط تلقائيًا. هذا هو النظام كله، لكن التفاصيل مهمة، وهذه هي.",
          },
          { type: "h2", text: "ثلاثة أنواع من النقاط ورصيد واحد" },
          {
            type: "p",
            text: "رصيدك هو مجموع ثلاث فئات. نقاط الخطة تصل مع كل فترة فوترة وتتجدد في بداية الفترة التالية. نقاط الشحن هي الحزم التي تشتريها فوق خطتك وتبقى صالحة اثني عشر شهرًا. النقاط الترويجية هي ما نمنحه نحن، مثل نقاط الترحيب لكل حساب جديد، وهي لا تنتهي أبدًا.",
          },
          {
            type: "ul",
            items: [
              "تُستهلك نقاط الخطة أولًا، فلا يُمس ما دفعته إضافيًا حتى ينتهي رصيد الشهر.",
              "ثم تُستهلك نقاط الشحن. لا يمكن استخدامها إلا مع خطة نشطة، ويتوقف عدّادها الزمني كلما لم تكن لديك خطة نشطة، فلا تخسر أبدًا وقتًا لم تستخدمه.",
              "وتُستهلك النقاط الترويجية أخيرًا، وهي لا تنتهي.",
            ],
          },
          { type: "h2", text: "كم يكلّف التوليد" },
          {
            type: "p",
            text: "نماذج الصور لها سعر ثابت لكل عملية توليد يتغيّر بحسب مستوى الجودة الذي تختاره. أما نماذج الفيديو فتُحاسب بالثانية: السعر الظاهر هو لمدة المقطع الافتراضية بالدقة المختارة، ويتغيّر مع المدة التي تحددها. الصوت الأصلي يكلّف أكثر في النماذج التي تفرض رسومًا عليه، والفيديو المرجعي يضيف تكلفة بالثانية لأن المزوّد يعالج تلك الإطارات أيضًا. الزر يعرض دائمًا الرقم النهائي محسوبًا بنفس الكود الذي يحاسب به الخادم.",
          },
          { type: "h2", text: "متى تعود النقاط" },
          {
            type: "p",
            text: "إذا فشلت مهمة لسبب يعود إلينا أو إلى مزوّد النموذج، كانقطاع أو انتهاء مهلة أو طلب مرفوض، يُعكس الخصم تلقائيًا ويتحدّث رصيدك خلال ثوانٍ. والفشل الناتج عن المُدخل نفسه، كمحتوى يرفضه فلتر الأمان لدى المزوّد، يُعامل بالطريقة نفسها. ما لا يُسترجع هو توليد اكتمل لكن نتيجته لم تكن كما تمنيت؛ فقد دُفع للمزوّد ثمن ذلك التصيير.",
          },
          { type: "h2", text: "لماذا التطبيق أغلى من الويب" },
          {
            type: "p",
            text: "تأخذ Apple وGoogle حصة من كل عملية شراء داخل التطبيق. الاشتراك عبر الويب يتجنّب تلك الحصة، ولهذا الخطة نفسها أرخص هنا. نقاطك واحدة أينما اشتريتها: سجّل الدخول على الويب بالحساب الذي تستخدمه في التطبيق وستجد رصيدك.",
          },
        ],
      },
    },
  },
  {
    slug: "kling-vs-seedance",
    date: "2026-08-28",
    tag: "models",
    readMinutes: 5,
    cta: { href: "/create-video" },
    accent: "purple",
    content: {
      en: {
        title: "Kling or Seedance? Picking a video model for the shot",
        excerpt:
          "Both families live in the same composer. They take different inputs, price differently, and shine on different briefs. A practical guide to choosing.",
        body: [
          {
            type: "p",
            text: "The video picker in Clickefy lists two families side by side: Kling from Kuaishou and Seedance from ByteDance. Switching between them is one click and the prompt carries over, so the real question is not which is better but which fits the input you have and the clip you want.",
          },
          { type: "h2", text: "Start with your input" },
          {
            type: "p",
            text: "If you have one still and want it to move, both families do image-to-video from a start frame, and both accept an optional end frame to steer where the motion lands. Kling 2.6 and 2.5 Turbo require a start frame; Kling 3, Kling 3 Omni and every Seedance model also work from text alone.",
          },
          {
            type: "p",
            text: "If you have several references, a product from three angles, a character sheet, a mood board, Seedance is built for it. Seedance 2.5 takes up to thirty reference images, up to ten reference video clips and up to ten audio clips in a single request, and it can edit or extend an existing clip. Kling 3 Omni and Kling O1 accept reference images too, up to seven, addressed in the prompt as @image_1, @image_2 and so on.",
          },
          { type: "h2", text: "Sound" },
          {
            type: "p",
            text: "Seedance generates native audio, ambience, effects and lip-synced dialogue written in the prompt, on every model in the line. Kling 2.6, Kling 3 and Kling 3 Omni generate native audio as well; on Kling 2.6 it needs the 1080p tier. Kling O1 is different: its audio switch keeps the original sound of a reference video rather than synthesising new sound. Sound is on by default wherever a model supports it, and the price on the button already includes it.",
          },
          { type: "h2", text: "Length and resolution" },
          {
            type: "ul",
            items: [
              "Kling 2.6 and 2.5 Turbo: 5 or 10 seconds, 720p or 1080p.",
              "Kling 3 and Kling 3 Omni: any whole second from 3 to 15, up to 4K. Kling 3 Turbo tops out at 1080p; Kling O1 at 10 seconds and 1080p.",
              "Seedance 2.0: 4 to 15 seconds, up to 4K on the Standard model, 720p on Fast and Mini.",
              "Seedance 2.5: 4 to 30 seconds, up to 1080p.",
            ],
          },
          { type: "h2", text: "Aspect ratio" },
          {
            type: "p",
            text: "With a start frame attached, both families follow the frame's own shape, so the ratio picker locks. For text-to-video, Kling offers 16:9, 9:16 and 1:1; Seedance adds 4:3, 3:4 and 21:9.",
          },
          { type: "h2", text: "A rule of thumb" },
          {
            type: "p",
            text: "One image that needs to come alive with a clean, cinematic look: Kling 3 or Kling 2.6. A product or character that must stay consistent across a longer clip built from several references, or a clip you already have that needs editing or extending: Seedance 2.5. Quick drafts to test an idea before spending on the final: Seedance 2 Mini or Kling 3 Turbo. And when in doubt, run the same prompt on both; the credits for a five-second draft are small next to the time a wrong pick costs.",
          },
        ],
      },
      ar: {
        title: "Kling أم Seedance؟ كيف تختار نموذج الفيديو المناسب للقطة",
        excerpt:
          "العائلتان في نفس صندوق الإنشاء. تختلفان في المُدخلات والتسعير وفيما تتفوّقان فيه. دليل عملي للاختيار.",
        body: [
          {
            type: "p",
            text: "تعرض قائمة نماذج الفيديو في Clickefy عائلتين جنبًا إلى جنب: Kling من Kuaishou وSeedance من ByteDance. التبديل بينهما نقرة واحدة والوصف ينتقل معك، فالسؤال الحقيقي ليس أيهما أفضل، بل أيهما يناسب المُدخل الذي لديك والمقطع الذي تريده.",
          },
          { type: "h2", text: "ابدأ من مُدخلك" },
          {
            type: "p",
            text: "إذا كانت لديك صورة واحدة وتريد أن تتحرك، فكلا العائلتين تحوّل الصورة إلى فيديو من إطار البداية، وتقبلان إطار نهاية اختياريًا لتوجيه الحركة. Kling 2.6 و2.5 Turbo يشترطان إطار بداية؛ أما Kling 3 وKling 3 Omni وكل نماذج Seedance فتعمل من النص وحده أيضًا.",
          },
          {
            type: "p",
            text: "إذا كانت لديك مراجع متعددة، منتج من ثلاث زوايا، أو ورقة شخصية، أو لوحة إلهام، فـ Seedance مصمم لذلك. يقبل Seedance 2.5 حتى ثلاثين صورة مرجعية وحتى عشرة مقاطع فيديو مرجعية وحتى عشرة مقاطع صوتية في طلب واحد، ويمكنه تعديل مقطع موجود أو تمديده. ويقبل Kling 3 Omni وKling O1 صورًا مرجعية أيضًا، حتى سبع صور، يُشار إليها في الوصف بـ @image_1 و@image_2 وهكذا.",
          },
          { type: "h2", text: "الصوت" },
          {
            type: "p",
            text: "يولّد Seedance صوتًا أصليًا، أجواءً ومؤثرات وحوارًا متزامنًا مع حركة الشفاه كما هو مكتوب في الوصف، في كل نماذج السلسلة. ويولّد Kling 2.6 وKling 3 وKling 3 Omni صوتًا أصليًا كذلك؛ وفي Kling 2.6 يتطلب ذلك مستوى 1080p. أما Kling O1 فمختلف: مفتاح الصوت فيه يحافظ على الصوت الأصلي للفيديو المرجعي بدل تركيب صوت جديد. الصوت مفعّل افتراضيًا حيثما يدعمه النموذج، والسعر على الزر يشمله.",
          },
          { type: "h2", text: "المدة والدقة" },
          {
            type: "ul",
            items: [
              "Kling 2.6 و2.5 Turbo: 5 أو 10 ثوانٍ، بدقة 720p أو 1080p.",
              "Kling 3 وKling 3 Omni: أي ثانية كاملة من 3 إلى 15، حتى 4K. يتوقف Kling 3 Turbo عند 1080p؛ وKling O1 عند 10 ثوانٍ و1080p.",
              "Seedance 2.0: من 4 إلى 15 ثانية، حتى 4K في النموذج Standard، و720p في Fast وMini.",
              "Seedance 2.5: من 4 إلى 30 ثانية، حتى 1080p.",
            ],
          },
          { type: "h2", text: "نسبة الأبعاد" },
          {
            type: "p",
            text: "مع إطار بداية مرفق تتبع العائلتان شكل الإطار نفسه، فيُقفل اختيار النسبة. وفي التوليد من النص يوفّر Kling النسب 16:9 و9:16 و1:1؛ ويضيف Seedance 4:3 و3:4 و21:9.",
          },
          { type: "h2", text: "قاعدة عملية" },
          {
            type: "p",
            text: "صورة واحدة تحتاج أن تحيا بمظهر سينمائي نظيف: Kling 3 أو Kling 2.6. منتج أو شخصية يجب أن تبقى متّسقة عبر مقطع أطول مبني من مراجع عدة، أو مقطع لديك بالفعل يحتاج تعديلًا أو تمديدًا: Seedance 2.5. مسوّدات سريعة لاختبار فكرة قبل الإنفاق على النسخة النهائية: Seedance 2 Mini أو Kling 3 Turbo. وعند الشك، شغّل الوصف نفسه على كليهما؛ فنقاط مسوّدة من خمس ثوانٍ قليلة مقارنةً بالوقت الذي يكلّفه اختيار خاطئ.",
          },
        ],
      },
    },
  },
  {
    slug: "camera-angle-tool",
    date: "2026-08-22",
    tag: "product",
    readMinutes: 3,
    cta: { href: "/create?tool=camera" },
    accent: "turquoise",
    content: {
      en: {
        title: "Camera Angle: re-shoot a photo without a reshoot",
        excerpt:
          "Upload a photo, orbit the camera around it, and get the same scene from the new position. What the tool does, what it keeps, and where it has to invent.",
        body: [
          {
            type: "p",
            text: "Most product and portrait shoots end with one hero image and a wish for two more angles. Camera Angle is the studio tool for that wish. You give it one photo and a camera position; it gives you the same subject, same light, same styling, seen from where you parked the camera.",
          },
          { type: "h2", text: "How you use it" },
          {
            type: "p",
            text: "Open it from the Create page, the navbar, or any image tile's menu. The stage shows your photo inside a wireframe sphere with the camera fixed at the front. Drag to orbit: horizontal drag moves the camera around the subject, vertical drag raises or lowers it, and the readout shows the exact azimuth and elevation in degrees. Reset snaps back to the original position.",
          },
          {
            type: "p",
            text: "Behind the subject, past ninety degrees either way, the stage dims. That is a signal, not a block: the model will be inventing the side the original photo never saw, and it is worth knowing that before you generate.",
          },
          { type: "h2", text: "What happens when you generate" },
          {
            type: "p",
            text: "The prompt is engineered on the server from your two angles and never shown; your job details record the tool and the angles, not a wall of text. The image goes to GPT Image 2 at its highest quality tier, the aspect ratio is matched to your photo's shape, and the result lands in your project grid as a normal generation, with re-use, favorites and download like any other.",
          },
          { type: "h2", text: "What it keeps, what it changes" },
          {
            type: "ul",
            items: [
              "Kept: the subject, its materials and labels, the lighting direction, the background and the overall grade.",
              "Changed: only the camera position. Composition follows from that, so a tall product shot from above will show more of the top surface, as it would on set.",
              "Invented, when needed: surfaces the original did not show. A 180-degree turn is asking the model to imagine the back of the box.",
            ],
          },
          {
            type: "quote",
            text: "The best results come from angles a photographer would actually use: a 30 to 45 degree orbit, a little elevation. Extreme positions work, but they lean harder on the model's guesses.",
          },
        ],
      },
      ar: {
        title: "زاوية الكاميرا: أعِد تصوير صورتك دون جلسة تصوير جديدة",
        excerpt:
          "ارفع صورة، ودر بالكاميرا حولها، واحصل على نفس المشهد من الموضع الجديد. ما تفعله الأداة، وما تحافظ عليه، وأين تضطر إلى التخيّل.",
        body: [
          {
            type: "p",
            text: "تنتهي أغلب جلسات تصوير المنتجات والبورتريه بصورة رئيسية واحدة وأمنية بزاويتين إضافيتين. أداة زاوية الكاميرا هي أداة الاستوديو لتلك الأمنية. تعطيها صورة واحدة وموضعًا للكاميرا؛ فتعطيك الموضوع نفسه بالإضاءة نفسها والتنسيق نفسه، مرئيًا من حيث وضعت الكاميرا.",
          },
          { type: "h2", text: "كيف تستخدمها" },
          {
            type: "p",
            text: "افتحها من صفحة الإنشاء أو شريط التنقل أو من قائمة أي صورة في مشروعك. تعرض المنصة صورتك داخل كرة شبكية والكاميرا ثابتة في المقدمة. اسحب لتدور: السحب الأفقي يحرّك الكاميرا حول الموضوع، والسحب العمودي يرفعها أو يخفضها، والقراءة تعرض زاويتَي السمت والارتفاع بالدرجات. زر الإعادة يرجع إلى الموضع الأصلي.",
          },
          {
            type: "p",
            text: "خلف الموضوع، بعد تسعين درجة في أي اتجاه، تخفت المنصة. هذه إشارة لا منع: سيتخيّل النموذج الجانب الذي لم تره الصورة الأصلية أبدًا، ومن المفيد معرفة ذلك قبل التوليد.",
          },
          { type: "h2", text: "ماذا يحدث عند التوليد" },
          {
            type: "p",
            text: "يُبنى الوصف على الخادم من زاويتيك ولا يُعرض أبدًا؛ فتفاصيل مهمتك تسجّل الأداة والزوايا، لا جدارًا من النص. تُرسل الصورة إلى GPT Image 2 بأعلى مستوى جودة، وتُطابَق نسبة الأبعاد مع شكل صورتك، وتصل النتيجة إلى شبكة مشروعك كتوليد عادي، مع إعادة الاستخدام والمفضلة والتنزيل كأي نتيجة أخرى.",
          },
          { type: "h2", text: "ما تحافظ عليه وما تغيّره" },
          {
            type: "ul",
            items: [
              "تحافظ على: الموضوع ومواده وملصقاته، واتجاه الإضاءة، والخلفية، والطابع اللوني العام.",
              "تغيّر: موضع الكاميرا فقط. ويتبع التكوين ذلك، فلقطة منتج طويل من الأعلى ستُظهر مزيدًا من سطحه العلوي، كما يحدث في الاستوديو.",
              "تتخيّل عند الحاجة: الأسطح التي لم تُظهرها الصورة الأصلية. الدوران 180 درجة يطلب من النموذج أن يتخيّل ظهر العلبة.",
            ],
          },
          {
            type: "quote",
            text: "أفضل النتائج تأتي من زوايا يستخدمها المصوّر فعلًا: دوران بين 30 و45 درجة مع ارتفاع بسيط. المواضع المتطرفة تعمل، لكنها تعتمد أكثر على تخمينات النموذج.",
          },
        ],
      },
    },
  },
];

export function getPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}

/** Newest first. */
export function listPosts(): BlogPost[] {
  return [...BLOG_POSTS].sort((a, b) => (a.date < b.date ? 1 : -1));
}
