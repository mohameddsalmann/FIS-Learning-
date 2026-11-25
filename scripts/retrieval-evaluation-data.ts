// Authored synthetic teaching excerpts and reviewed page labels. Each passage is one fixture page.
export const readings = [
  {
    id: "optics", title: "Optics Essentials", language: "en", pages: [
      ["reflection", "Reflection\nReflection occurs when light returns from a boundary. The angle of incidence equals the angle of reflection. Both angles are measured from the normal, a line perpendicular to the surface."],
      ["refraction", "Refraction\nRefraction changes the direction of light as it crosses between materials at an angle. Entering a material with a higher refractive index usually bends the light toward the normal. Along the normal there is no change of direction."],
      ["lens", "Converging Lens\nParallel rays pass through a converging lens and meet at the principal focus. The focal length is the distance from the center of the lens to that focus. The lens acts by refraction."],
      ["dispersion", "Dispersion\nDispersion separates colors because a material's refractive index depends on wavelength. In a typical glass prism violet light bends more than red light. Dispersion does not mean light disappears."],
    ],
  },
  {
    id: "astronomy", title: "Observing the Sky", language: "en", pages: [
      ["phases", "Moon Phases\nThe Moon always has a sunlit half except during a lunar eclipse. Its phases show how much of that illuminated half is visible from Earth. Near a full Moon, nearly the whole illuminated half faces Earth."],
      ["eclipse", "Lunar Eclipse\nA lunar eclipse occurs when Earth passes between the Sun and the Moon and its shadow falls on the Moon. This can occur at full Moon, but the tilted orbit usually keeps the Moon out of Earth's shadow."],
      ["season", "Seasons\nEarth's axial tilt changes the angle of incoming sunlight and the length of daylight. A hemisphere tilted toward the Sun receives more direct light and longer days. Earth's changing distance from the Sun is not the main explanation."],
      ["stellar", "Stellar Parallax\nA nearby star appears to shift relative to distant stars when observed from different positions in Earth's orbit. A larger parallax angle means a smaller distance. Astronomers compare observations taken about six months apart."],
    ],
  },
  {
    id: "statistics", title: "قراءة البيانات", language: "ar", pages: [
      ["mean", "المتوسط الحسابي\nالمتوسط الحسابي هو مجموع القيم مقسوما على عددها. مثال: متوسط القيم 2 و4 و9 يساوي 5. تؤثر القيمة المتطرفة كثيرا في المتوسط الحسابي."],
      ["median", "الوسيط\nالوسيط هو القيمة الواقعة في منتصف البيانات بعد ترتيبها. عند وجود عدد زوجي من القيم يؤخذ متوسط القيمتين الوسطيتين. تأثير القيمة المتطرفة على الوسيط أصغر عادة."],
      ["spread", "المدى\nالمدى هو الفرق بين أكبر قيمة وأصغر قيمة في البيانات. مثال: مدى القيم 2 و4 و9 يساوي 7. لا يوضح المدى كيفية توزع القيم بين الطرفين."],
      ["correlation", "الارتباط والسببية\nالارتباط يعني أن متغيرين يتغيران معا بطريقة منتظمة. لا يثبت الارتباط أن أحد المتغيرين يسبب الآخر، فقد يؤثر عامل ثالث في كليهما."],
    ],
  },
  {
    id: "computing", title: "مبادئ الحوسبة", language: "ar", pages: [
      ["stack", "المكدس\nالمكدس هي بنية بيانات تخرج منها آخر قيمة دخلت أولا. مثال: وظيفة التراجع قد تستخدم مكدسا لإلغاء آخر إجراء قبل غيره."],
      ["queue", "الطابور\nالطابور هو بنية بيانات تخرج منها أول قيمة دخلت أولا. مثال: طلبات الطباعة تعالج بترتيب وصولها في الطابور."],
      ["search", "البحث الثنائي\nالبحث الثنائي يقسم نطاق البحث إلى نصفين في كل خطوة. يشترط ترتيب البيانات قبل تطبيقه. تقارن القيمة المطلوبة بالعنصر الأوسط لاستبعاد أحد النصفين."],
      ["cache", "الذاكرة المؤقتة\nالذاكرة المؤقتة تحتفظ بنسخة من بيانات استخدمت سابقا لتسريع طلب لاحق. عند تحديث المصدر قد تصبح النسخة قديمة، ولذلك تحدد سياسة لإبطالها."],
    ],
  },
] as const;

export interface RetrievalQuestion {
  id: string;
  language: "en" | "ar";
  type: "definition" | "comparison" | "multi-section" | "cross-language" | "unsupported";
  query: string;
  relevance: Record<string, 1 | 2>;
  expected: string;
}

export const questions: RetrievalQuestion[] = [
  { id: "Q01", language: "en", type: "definition", query: "How is the reflection angle measured?", relevance: { reflection: 2 }, expected: "From the normal, not the surface." },
  { id: "Q02", language: "en", type: "definition", query: "Which way does an oblique ray bend in a higher refractive index?", relevance: { refraction: 2 }, expected: "Toward the normal." },
  { id: "Q03", language: "en", type: "definition", query: "What does focal length measure?", relevance: { lens: 2 }, expected: "Distance from lens center to principal focus." },
  { id: "Q04", language: "en", type: "definition", query: "Why does glass dispersion separate colors?", relevance: { dispersion: 2, refraction: 1 }, expected: "Refractive index varies by wavelength." },
  { id: "Q05", language: "en", type: "definition", query: "What changes during the Moon's phases?", relevance: { phases: 2 }, expected: "The fraction of the illuminated half visible from Earth." },
  { id: "Q06", language: "en", type: "definition", query: "What casts the shadow during a lunar eclipse?", relevance: { eclipse: 2 }, expected: "Earth casts its shadow on the Moon." },
  { id: "Q07", language: "en", type: "definition", query: "What makes daylight longer during summer?", relevance: { season: 2 }, expected: "Axial tilt points the hemisphere toward the Sun." },
  { id: "Q08", language: "en", type: "definition", query: "What is stellar parallax?", relevance: { stellar: 2 }, expected: "Apparent shift of a nearby star from different orbital positions." },
  { id: "Q09", language: "en", type: "definition", query: "What happens to a ray arriving along the normal while crossing into another material?", relevance: { refraction: 2 }, expected: "Its direction does not change." },
  { id: "Q10", language: "en", type: "definition", query: "Where do parallel rays from a converging lens meet?", relevance: { lens: 2 }, expected: "The principal focus." },
  { id: "Q11", language: "ar", type: "definition", query: "كيف أحسب المتوسط الحسابي للقيم؟", relevance: { mean: 2 }, expected: "اقسم مجموع القيم على عددها." },
  { id: "Q12", language: "ar", type: "definition", query: "كيف نجد الوسيط عندما يكون عدد القيم زوجيا؟", relevance: { median: 2 }, expected: "نحسب متوسط القيمتين الوسطيتين بعد الترتيب." },
  { id: "Q13", language: "ar", type: "definition", query: "ما المَدَى لمجموعة بيانات؟", relevance: { spread: 2 }, expected: "الفرق بين أكبر وأصغر قيمة." },
  { id: "Q14", language: "ar", type: "definition", query: "لماذا لا يكفي الارتباط لإثبات السببية؟", relevance: { correlation: 2 }, expected: "قد يؤثر عامل ثالث في المتغيرين." },
  { id: "Q15", language: "ar", type: "definition", query: "ما بنية البيانات التي تخرج آخر قيمة دخلت أولا؟", relevance: { stack: 2, queue: 1 }, expected: "المكدس." },
  { id: "Q16", language: "ar", type: "definition", query: "كيف يرتب الطابور طلبات الطباعة؟", relevance: { queue: 2 }, expected: "يعالجها بترتيب الوصول." },
  { id: "Q17", language: "ar", type: "definition", query: "ما شرط تطبيق البحث الثنائي؟", relevance: { search: 2 }, expected: "ترتيب البيانات أولا." },
  { id: "Q18", language: "ar", type: "definition", query: "متى تصبح نسخة الذّاكرة المؤقتة قديمة؟", relevance: { cache: 2 }, expected: "عند تحديث البيانات في المصدر." },
  { id: "Q19", language: "ar", type: "definition", query: "ما تأثير القيمة المتطرفة على المتوسط الحسابي؟", relevance: { mean: 2, median: 1 }, expected: "تؤثر فيه كثيرا." },
  { id: "Q20", language: "ar", type: "definition", query: "ما وظيفة العنصر الأوسط في البحث الثنائي؟", relevance: { search: 2 }, expected: "تساعد مقارنته بالقيمة المطلوبة على استبعاد نصف النطاق." },
  { id: "Q21", language: "ar", type: "cross-language", query: "ما قانون انعكاس الضوء عند الحدود؟", relevance: { reflection: 2 }, expected: "زاوية السقوط تساوي زاوية الانعكاس." },
  { id: "Q22", language: "ar", type: "cross-language", query: "لماذا ينحرف الضوء البنفسجي أكثر من الأحمر في المنشور؟", relevance: { dispersion: 2, refraction: 1 }, expected: "يعتمد معامل الانكسار على الطول الموجي." },
  { id: "Q23", language: "ar", type: "cross-language", query: "ماذا تعني زاوية اختلاف المنظر الأكبر لنجم قريب؟", relevance: { stellar: 2 }, expected: "المسافة إلى النجم أصغر." },
  { id: "Q24", language: "ar", type: "cross-language", query: "هل تتسبب المسافة من الشمس في الفصول؟", relevance: { season: 2 }, expected: "الميل المحوري هو التفسير الأساسي." },
  { id: "Q25", language: "ar", type: "cross-language", query: "لماذا لا يحدث الخسوف عند كل بدر؟", relevance: { eclipse: 2, phases: 1 }, expected: "ميل مدار القمر يبقيه عادة خارج ظل الأرض." },
  { id: "Q26", language: "en", type: "cross-language", query: "How do I calculate the range?", relevance: { spread: 2 }, expected: "Subtract the smallest value from the largest." },
  { id: "Q27", language: "en", type: "cross-language", query: "Is a median or a mean less sensitive to an outlier?", relevance: { median: 2, mean: 2 }, expected: "The median is usually less sensitive." },
  { id: "Q28", language: "en", type: "cross-language", query: "Which data structure does a printer queue use?", relevance: { queue: 2 }, expected: "A first-in, first-out queue." },
  { id: "Q29", language: "en", type: "cross-language", query: "What condition must hold before binary search can exclude half?", relevance: { search: 2 }, expected: "The data must be sorted." },
  { id: "Q30", language: "en", type: "cross-language", query: "Why does a cache need an invalidation policy?", relevance: { cache: 2 }, expected: "The cached copy may be stale after a source update." },
  { id: "Q31", language: "en", type: "comparison", query: "Compare reflection and refraction at a boundary.", relevance: { reflection: 2, refraction: 2 }, expected: "Reflected light returns from the boundary. Refracted light crosses the boundary and can bend." },
  { id: "Q32", language: "en", type: "comparison", query: "How is dispersion different from converging lens action?", relevance: { dispersion: 2, lens: 2, refraction: 1 }, expected: "Dispersion separates colors. A converging lens brings parallel rays to a focus." },
  { id: "Q33", language: "en", type: "comparison", query: "Is a lunar eclipse the same as ordinary Moon phases?", relevance: { eclipse: 2, phases: 2 }, expected: "An eclipse involves Earth's shadow. Ordinary phases change which lit portion is visible." },
  { id: "Q34", language: "ar", type: "comparison", query: "قارن المكدس بالطابور في ترتيب خروج القيم.", relevance: { stack: 2, queue: 2 }, expected: "آخر قيمة دخلت هي أول قيمة تخرج من المكدس، والعكس في الطابور." },
  { id: "Q35", language: "ar", type: "comparison", query: "قارن الوسيط والمتوسط الحسابي عند وجود قيمة متطرفة.", relevance: { median: 2, mean: 2 }, expected: "يتأثر الوسيط عادة بدرجة أقل." },
  { id: "Q36", language: "ar", type: "comparison", query: "ما الفرق بين المدى والوسيط؟", relevance: { spread: 2, median: 2 }, expected: "المدى فرق الطرفين، والوسيط مركز القيم المرتبة." },
  { id: "Q37", language: "ar", type: "comparison", query: "ما الفرق بين انعكاس الضوء وانكساره؟", relevance: { reflection: 2, refraction: 2 }, expected: "الانعكاس يعيد الضوء من الحد، والانكسار يغير اتجاهه عند العبور." },
  { id: "Q38", language: "en", type: "comparison", query: "Compare using a stack for undo and a queue for printing.", relevance: { stack: 2, queue: 2 }, expected: "Undo handles the most recent action first. Printing handles the first request first." },
  { id: "Q39", language: "en", type: "multi-section", query: "How does refraction operate in converging lenses and glass prisms?", relevance: { lens: 2, refraction: 2, dispersion: 2 }, expected: "A change of medium bends rays. Lenses focus rays and prisms bend different wavelengths by different amounts." },
  { id: "Q40", language: "en", type: "multi-section", query: "What does the Moon look like near full Moon, and why might Earth not cast its shadow then?", relevance: { phases: 2, eclipse: 2 }, expected: "Almost the whole sunlit half is visible. Usually the tilted orbit avoids Earth's shadow." },
  { id: "Q41", language: "ar", type: "multi-section", query: "احسب المتوسط الحسابي والوسيط والمدى للقيم 2 و4 و9.", relevance: { mean: 2, median: 2, spread: 2 }, expected: "المتوسط 5، الوسيط 4، المدى 7." },
  { id: "Q42", language: "en", type: "multi-section", query: "What is sorted data in binary search useful for, and how could a cache become stale after the original data changes?", relevance: { search: 2, cache: 2 }, expected: "Ordering makes it possible to rule out half. An updated original can make an older cached copy stale." },
  { id: "Q43", language: "ar", type: "multi-section", query: "لماذا تكون الأيام أطول في الصيف وكيف تقاس مسافة نجم قريب باختلاف المنظر؟", relevance: { season: 2, stellar: 2 }, expected: "يميل نصف الأرض نحو الشمس ويطول النهار. تغير موضع الرصد يكشف تغير الموضع الظاهري للنجم." },
  { id: "Q44", language: "en", type: "multi-section", query: "Where is the normal defined and what happens when light crosses a boundary along it?", relevance: { reflection: 2, refraction: 2 }, expected: "The normal is perpendicular to the surface. Crossing the boundary along the normal leaves direction unchanged." },
  { id: "Q45", language: "en", type: "unsupported", query: "Who wrote the first opera performed in Cairo?", relevance: {}, expected: "No reading describes opera." },
  { id: "Q46", language: "ar", type: "unsupported", query: "ما مكونات وصفة الكشري التقليدية؟", relevance: {}, expected: "لا تتضمن القراءات وصفات طعام." },
  { id: "Q47", language: "en", type: "unsupported", query: "What price does the book quote for a converging lens?", relevance: {}, expected: "The lens page contains no prices." },
  { id: "Q48", language: "ar", type: "unsupported", query: "متى اخترعت طابعة الليزر الأولى؟", relevance: {}, expected: "لا تؤرخ القراءات لاختراع طابعة الليزر." },
  { id: "Q49", language: "en", type: "unsupported", query: "How many kilometers from Earth was the Moon on July 21, 1969?", relevance: {}, expected: "The readings report no historical Moon distances." },
  { id: "Q50", language: "ar", type: "unsupported", query: "ما سعر تذكرة المرصد الفلكي؟", relevance: {}, expected: "لا تتضمن القراءات أسعار تذاكر." },
];
