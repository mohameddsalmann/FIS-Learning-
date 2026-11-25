# FIS Learning 2.0 — مراجعة حالة المشروع بالأدلة

- **Audit date:** 2026-11-23، توقيت القاهرة `UTC+02:00`.
- **Branch:** `codex/fis-learning-2`. **HEAD:** `c0210d73fbddf0e52aa40744e63f4a6fd90e9ebb`.
- **Reviewed revision:** نسخة الشغل المحلية. وقت بدء المراجعة كان فيه 10 ملفات tracked متعدلة؛ `src/` و`prisma/` و`tests/` و`docs/` و`.github/` و`scripts/` لسه untracked. الـHEAD نفسه بيرجع للـExpress والواجهة القديمة. نتيجة الاختبارات مرتبطة بنسخة الشغل اللي اتبنت واتشغلت.
- **Public release verdict:** `Not Ready`. **Local prepared demo:** `VERIFIED LOCAL`.
- **Scope:** قراءة الكود وتقارير التنفيذ والاختبارات وقراءة Vercel metadata، وتشغيل اختبارات على قواعد disposable. التعديل المقصود في الريبو خلال المراجعة هو الملف ده.

## طريقة قراءة الأدلة

كل صف له `ID` ثابت وحالة واحدة. `VERIFIED LIVE` يعني خدمة خارجية حقيقية نجحت في السيناريو المحدد. `VERIFIED LOCAL` يعني اختبار حقيقي على التطبيق المحلي. `VERIFIED CONTROLLED` يعني إن جزء مهم من السيناريو اتبدل بـfixture أو mock. `IMPLEMENTED ONLY` يعني الكود موجود بدون إثبات تشغيل كفاية. `PARTIAL` يعني إن جزء من المطلوب اتنفذ أو اتثبت ولسه شروط ناقصة. `FAILED` يعني محاولة التحقق المذكورة فشلت. `BLOCKED` يعني فيه إعداد أو صلاحية خارجية ناقصة. `NOT IMPLEMENTED` يعني الوظيفة المطلوبة لسه مفيش تنفيذ شغّال لها. `UNKNOWN` يعني الأدلة غير كافية لتحديد النتيجة. رقم الاختبارات بيحسب سيناريوهات الاختبار. مفيش نسبة إجمالية للمشروع لأن كل مجموعة فيها شروط مختلفة.

- `T1`–`T11` نتائج تشغيل جديدة في المراجعة بتاريخ 23 نوفمبر. قاعدة التطبيق والـload مختلفة ومهاجرة على `127.0.0.1:55442`، وتقييم البحث استخدم `fis_retrieval_eval` المخصصة. كل قواعد البيانات المستخدمة في الاختبارات دي محلية.
- `H1`–`H4` نتائج سابقة موثقة في [Implementation and release evidence](IMPLEMENTATION_STATUS.md)، وفق تاريخ كل صف. كلمة Live هنا ممكن تعني تطبيق محلي متصل بخدمة حقيقية.
- `S1` معاينة UX للصورة السابقة لشاشة Recovery laboratory، مع مراجعة طريقة توليد وعرض الاقتراحات في النسخة الحالية. `S2` صور جديدة لشاشة كورس مختلفة من التشغيل المتحكم فيه.

### نطاق مراجعة الكود والتقارير

| Area | Current source checked | Reconciliation |
|---|---|---|
| Routes | الصفحات `study` و`courses` و`chat` و`practice` و`progress` و`history` و`help` و`settings`. API groups هي `auth` و`documents` و`workspace` و`learning/{models,chat,notes,decision,quiz-generation,image,speech}` | build الحالي طلع handlers دي، وT5 وT8 غطوا رحلات محددة منها. [API contract](API.md) |
| Persistence | [Prisma schema](../prisma/schema.prisma)، migrations للـworkspace الأساسي ثم مراحل رفع ومعالجة PDF | T1 وT2 أعادوا التطبيق والاختبار على قاعدة جديدة. [Architecture](ARCHITECTURE.md) |
| Provider and RAG | Gemini/Groq/OpenRouter، Gateway وregistry، PDF jobs والـchunks، vector/FTS/hybrid والـscorer | نتائج البحث من T6، والـgrounding مفتوح حسب [Grounding audit](RAG_GROUNDING_AUDIT.md) وT7 |
| UI and releases | upload intake وcourse workspace وtutor وviewer وlearning help، وVercel config وCI | تقارير 10 و11 tests تخص runs مختلفة. T5 أعاد الـ11 على النسخة الحالية. نتيجة H1 الأحدث تقفل ملاحظة الـSHA-256 في فرع الـobject المتخزن. [Implementation status](IMPLEMENTATION_STATUS.md) |

## B1 — الملفات والكورسات

**الهدف.** الطالب يرفع PDF، يرجع يكمل لو الاتصال قطع، ويذاكر من موضوعات وأسئلة مرتبطة بالمحاضرة.

**اللي اتبنى.** Intake ينشئ كورس أو يختار كورس، وحجز ملف قبل النقل، وXHR للرفع الصغير ورفع مباشر للملفات فوق 4 MiB، ومراحل حفظ ومعالجة منفصلة. النص بيتقسم مع مراجع الصفحات، والفهرس والموضوعات والأسئلة بيتحفظوا في PostgreSQL. الأصل بيتخزن في Vercel Blob الخاص.

**اللي اتأكد.** نقل ونسبة progress حقيقية واسترجاع ملف سبق تخزينه وفتح نسخة مطابقة. اختبار محلي جديد ثبت إعادة استخدام الـreservation لما الـobject مش موجود. تحميل واقتراحات وقراءة أصل الملف ظهروا في الـbrowser، مع صلاحيات بين حسابين في الاختبارات المحلية.

**الفجوة.** فرع رفع PDF من جديد بعد انقطاع قبل تخزين الـobject لسه محتاج اختبار حقيقي. المسار الحالي للتأكد من الملف بيستخدم الحجم وتوقيع PDF وقت finalize. الـSHA-256 اتقاس في سكريبت التحقق للملف المختبر. OCR لملفات الصور بره مسار الاستخراج النصي الحالي.

| ID | Feature | Status | Last verification | Evidence | What's missing |
|---|---|---|---|---|---|
| B1.01 | رفع PDF | VERIFIED LIVE | 2026-11-23 سابق | H1، رفع مباشر لـ4,209,346 bytes. T5 وT8 لاختبار الانتقال والأخطاء | رحلة مماثلة في HTTPS Preview |
| B1.02 | Real transfer progress | VERIFIED LIVE | 2026-11-23 سابق | H1، Chrome رصد `0 < loaded < total` | قياس على اتصال بطيء باستمرار مع ملف أكبر في Preview |
| B1.03 | إلغاء الرفع | IMPLEMENTED ONLY | — | [upload transport](../src/components/study/upload.ts) يدعم `AbortSignal`، و[واجهة الرفع](../src/components/study/PdfUpload.tsx) تدير الإيقاف | اختبار ضغط زر الإلغاء أثناء نقل حقيقي والتحقق من حالة الحجز |
| B1.04 | Retry مع نفس الحجز | VERIFIED CONTROLLED | 2026-11-23 جديد | T2، غياب object و409 ثم إعادة استخدام الحجز ومهمة واحدة. T5، الاحتفاظ بالملف أثناء المحاولة | تجربة حقيقية تتأكد إن الملف لسه غايب قبل retry |
| B1.05 | Interrupted upload recovery | PARTIAL | 2026-11-23 | H1 مرتين لنفس الفرع بعد commit. T5 إعادة فتح الكورس المحجوز بعد refresh باستجابة controlled | اختبار فرع الـobject الغايب على Chrome وBlob الحقيقيين |
| B1.06 | تطابق SHA-256 بعد الرفع | VERIFIED LIVE | 2026-11-23 سابق | H1، أصل التحميل طابق `73021596fc3f3bb9ac0dbb34bcb7332bca4750f534910c1850657f3b82656de8` لملف 4,209,346 bytes | تغطية فرع retry الحقيقي؛ [storage](../src/server/documents/storage.ts) يتحقق من الحجم وتوقيع PDF |
| B1.07 | استخراج نص PDF | VERIFIED LIVE | 2026-11-23 سابق | H1، PDF نصي حقيقي وصل `READY`. T8 عالج PDF من 6 صفحات | PDF ممسوح ضوئيًا أو عينات أكثر في العربية المختلطة بالمعادلات |
| B1.08 | معالجة مستمرة على مراحل | VERIFIED LOCAL | 2026-11-23 جديد | T2، leases وإعادة المحاولة الانتقالية. H2 شهد المراحل حتى `READY` | اختبار الاستئناف بعد إغلاق التبويب خلال كل مرحلة، ومهل Preview |
| B1.09 | تقسيم النص وحفظ رقم الصفحة | VERIFIED LOCAL | 2026-11-23 جديد | T2، [chunks](../src/server/rag/chunks.ts) واختبارات RAG | corpus أكبر لتغطية جداول ومعادلات |
| B1.10 | توليد embeddings | VERIFIED LIVE | H3، التاريخ الدقيق غير مسجل | تقرير H3 سجّل فهرسة PDF حقيقية باستخدام live embedding. T6 وT8 استخدموا fixture مؤخرًا، وT2 اختبر استمرار فهرسة النص لو المزوّد غير متاح | إعادة التشغيل الحي على الـbuild الحالي مع تسجيل مزوّد الـembedding وأبعاد الفهرس |
| B1.11 | فهرس دائم في PostgreSQL | VERIFIED LOCAL | 2026-11-23 جديد | T1، T2 وT6، `DocumentChunk` وFTS وpgvector واسترجاع من الصفوف المحفوظة | إعادة نفس التحقق على Neon |
| B1.12 | موضوعات من المصدر | VERIFIED LOCAL | 2026-11-23 جديد | T2، [outline](../src/server/rag/outline.ts) وحفظ topic/source IDs في المعالجة | جودة العناوين عبر أنواع محاضرات أكتر |
| B1.13 | أسئلة مذاكرة مقترحة | PARTIAL | 2026-11-23 | T2 وT8 أثبتوا العرض والحفظ، وH2 سجل 6 prompts. S1 كشف تكرار وصياغة ضعيفة | مراجعة أسئلة Recovery، قص التكرار والتركيز على مفهوم واحد لكل سؤال |
| B1.14 | تخزين الأصل الخاص | VERIFIED LIVE | 2026-11-23 سابق | H1 استخدم Preview Blob الحقيقي مع التطبيق المحلي، ووصل للأصل برابط التطبيق المصرح | رحلة الدخول والرفع والتنظيف من HTTPS Preview |
| B1.15 | منع الوصول بين أصحاب الكورسات | VERIFIED CONTROLLED | 2026-11-23 جديد | T8، صاحب الملف يقدر يفتح الأصل، وحساب تاني حصل على 404 للأصل والـcitation. T2 وT5 عزلة محلية إضافية | تكرار حالة الحسابين مع Blob الحقيقي في Preview |

**أقرب خطوة.** كرر قطع النقل قبل commit، اتأكد إن finalize رجّع `409`، وبعد الرجوع استخدم نفس الحجز لحد `READY`، وقارن SHA-256. جرّب زر Cancel في نفس البيئة وسجّل النتيجة كحالة مستقلة.

## B2 — الذكاء الاصطناعي والـRAG

**الهدف.** المدرّس يفهم السؤال في سياق الكورس، يطلع دليل من الصفحة، ويشرح بطريقة الطالب يقدر يراجعها. المزوّد لازم يكون مؤهل للخطة المجانية.

**اللي اتبنى.** Gateway فيه Gemini وGroq وOpenRouter. فلترة OpenRouter بتفحص الموداليتي والحالة والسعر وقيود الـendpoint. Gemini وGroq محتاجين تأكيد الخطة، وxAI اختياري منفصل ومقفول افتراضيًا. فيه SSE streaming، بحث نصي ومتجهي ودمج وترتيب مشروط، teaching modes، وشروحات مرئية وإرفاق وسائط.

**اللي اتأكد.** في تشغيل سابق Gemini وGroq طلعوا ردود حقيقية. في تشغيل جديد البحث الهجين رفع Recall@5 من 80.68% إلى 93.56% في corpus ثابت. إضافة rerank حافظت على Recall وحسّنت nDCG قليلًا. صلة كل citation بالصفحة اتفحصت آليًا.

**الفجوة.** شغل OpenRouter الحقيقي واجه 429. تقييم صحة ادعاءات كل إجابة عبر الثلاث طرق لسه متعملش. كمان سؤالين غير مدعومين رجع لهم البحث نصوص قريبة، ومحتاجين تقييم هل المدرّس رفضهم صح.

| ID | Feature | Status | Last verification | Evidence | What's missing |
|---|---|---|---|---|---|
| B2.01 | Gemini | VERIFIED LIVE | 2026-11-23 سابق | H2، `google/gemini-3.5-flash-lite` رد وظهر مع citation وquiz محفوظ. T8 أعاد الاختبار بمزوّد متحكم فيه | نجاح عبر أيام مختلفة وعلى Preview. محاولات 3.8 و3.6 كان فيها timeout |
| B2.02 | Groq | VERIFIED LIVE | H3، التاريخ الدقيق غير مسجل | رد `GPT-OSS 20B` محفوظ في smoke سابق. تدقيق adapters في T2 | إعادة smoke على نفس build المرشح للنشر |
| B2.03 | OpenRouter live inference | FAILED | H3، التاريخ الدقيق غير مسجل | آخر محاولة حقيقية موثقة رجعت 429، والمزوّد المتحكم في T8 رجع ردًا | استجابة free end-to-end حقيقية وقت توفر quota |
| B2.04 | اختيار النماذج المجانية | VERIFIED CONTROLLED | 2026-11-23 جديد | T2، catalog وendpoint pricing وFree-tier flags وfail-closed؛ [registry](../src/server/ai/registry.ts) و[gateway](../src/server/ai/gateway.ts) | تحقق eligibility في بيئة Preview وتوافر capability لكل مزوّد |
| B2.05 | Fallback بين المزوّدين | VERIFIED CONTROLLED | 2026-11-23 جديد | T8، Gemini فشل ثم free OpenRouter fixture رد. T2 يغطي اختيار مسارات بديلة | fallback حي معروف التكلفة في Preview |
| B2.06 | Streaming وإيقاف الرد | PARTIAL | 2026-11-23 | H2 حي للـstream والحفظ. T8 إلغاء stream متحكم فيه نجح | إلغاء اتصال حي والتحقق من التوقف والحفظ الجزئي |
| B2.07 | Vector retrieval | VERIFIED CONTROLLED | 2026-11-23 جديد | T6، pgvector فعلي وembedding deterministic، Recall@5 ‏80.68% | embedding حي على corpus ممثل |
| B2.08 | Keyword retrieval | VERIFIED LOCAL | 2026-11-23 جديد | T2 وT6، PostgreSQL FTS حقيقي في [retrieval](../src/server/rag/retrieval.ts) | جدول نتائج keyword-only وتوسيع عينات عربي |
| B2.09 | Hybrid retrieval | VERIFIED CONTROLLED | 2026-11-23 جديد | T6، Recall@5 ‏93.56% على نفس الـ50 سؤال | توسيع corpus ومراجعة queries اللي معناها قريب |
| B2.10 | Conditional reranking | VERIFIED CONTROLLED | 2026-11-23 جديد | T6، استدعاء fixture واحد، Recall ثابت وnDCG من 0.92486 إلى 0.92732 | أثره وتكلفته وزمنه في حالات واقعية أكتر |
| B2.11 | صحة موضع الـcitation | VERIFIED CONTROLLED | 2026-11-23 جديد | T6، ‏59/59 ثم 125/125 ثم 125/125 روابط أدلة صالحة في corpus. H2 مصدر حي صفحة 1 | التحقق من إن الصفحة تسند الادعاء نفسه في تقييم B2.12 |
| B2.12 | Generated-answer grounding | PARTIAL | 2026-11-23 | H2 حالتان claim-level في إجابة Gemini واحدة. T7 يرفض dataset ناقص. [Evaluator](../scripts/evaluate-grounding.ts) | 150 خانة review فعلية، مع توثيق المزوّد والموديل ومراجعة بشرية للإجابات والرفض |
| B2.13 | رفض سؤال بدون سند | PARTIAL | 2026-11-23 جديد | T8، `422` عند مفيش مصادر. T6، ‏4/6 مفيش نتائج، Q47 وQ48 جابوا مقاطع قريبة مع كل طريقة | مراجعة رد المدرّس على الأسئلة اللي لها نص قريب بدون إجابة |
| B2.14 | Structured teaching | VERIFIED CONTROLLED | 2026-11-23 جديد | T2 وT8، أوضاع شرح مختلفة وعرض JSON المسموح ورفض أجزاء غير صالحة | تقييم جودة تعليمية بشرية على أكثر من نوع سؤال |
| B2.15 | شروحات مرئية مرتبطة بالنص | VERIFIED LIVE | 2026-11-23 سابق | H2، رسم من بيانات PDF مع `2 N → 4 cm` والتنقل بالكيبورد. T8 اختبار العرض | corpus جداول ورسومات أكبر؛ توفر generated illustration مختلف عن الرسم من المصدر |
| B2.16 | Generated illustration | IMPLEMENTED ONLY | — | [Image endpoint](../src/app/api/learning/image/route.ts) و[StudyIllustration](../src/components/study/StudyIllustration.tsx) مرتبطين بموديل متاح | توليد حي من endpoint مؤهل وحفظ دليل التحقق |
| B2.17 | صورة وMP4 كمدخلات | VERIFIED LIVE | H3، التاريخ الدقيق غير مسجل | H3، Gemini رد على الصورة والفيديو في smoke سابق | إعادة تشغيل على build الحالي، وحالات أحجام وإخفاق منفصلة |
| B2.18 | الصوت، Dictation وRead aloud | PARTIAL | 2026-11-23، مراجعة كود | [Dictation](../src/components/study/Dictation.tsx) و[Speech route](../src/app/api/learning/speech/route.ts)، مع contract checks في T2 | إثبات dictation على الأجهزة المدعومة وTTS من مزوّد حقيقي |
| B2.19 | حد مرفقات رسالة Tutor | IMPLEMENTED ONLY | 2026-11-23، مراجعة كود | [AI request parser](../src/server/ai/requests.ts) يحدد 5 ملفات، مع حدود مستقلة لإجمالي الحجم | رفع 5 مرفقات صالحة في رسالة والتحقق من رفض السادس ومن احترام سقف الحجم |

**أقرب خطوة.** استخدم template التقييم لملء إجابات الثلاث variants مع الصفحات والادعاءات وحكم المراجع، وراجع الرفض في Q47 وQ48. نفّذ smoke صغير لـGemini/Groq وOpenRouter حسب eligibility والـquota قبل اعتماد كل capability.

## B3 — تجربة الطالب

**الهدف.** الطالب يفهم يبدأ منين، يذاكر من المحاضرة على الموبايل، وبعدها يعرف تقدّمه وإيه اللي محتاج يراجعه.

**اللي اتبنى.** الصفحة الرئيسية فيها مسار PDF ومسار optics جاهز. الكورس بيجمع المحاضرات، المدرّس، المصدر، والـQuiz. فيه EN/AR، سجل، Progress، Help، جولة اختيارية وقائمة بدء. الاختيارات التفاعلية في التطبيق الحالي مبنية على الـshared combobox.

**اللي اتأكد.** رحلة optics الجاهزة اشتغلت من غير حساب ومزوّد. اختبارات العرض والتحكم شغلت رحلة عربية، مصدر كـdrawer على الموبايل وكـpanel على الديسكتوب، فتح الصفحة الصحيحة، رجوع الـfocus، ومحاولة quiz محفوظة. ده بيثبت تنفيذ السيناريوهات المختبرة.

| ID | Feature | Status | Last verification | Evidence | What's missing |
|---|---|---|---|---|---|
| B3.01 | وضوح Homepage | PARTIAL | 2026-11-23 جديد | Build وbrowser للطرق الأساسية؛ [Homepage](../src/app/page.tsx) فيها مسار رفع ومسار sample | اختبار فهم زر البداية مع طلاب أول مرة |
| B3.02 | التنقل داخل الكورس | VERIFIED LOCAL | 2026-11-23 جديد | T5 انتقال من intake إلى course، وفتح كورس محفوظ وإعادة تحميله | تجربة مستخدمين قبل التسجيل وبعده على HTTPS |
| B3.03 | AI Tutor | VERIFIED LIVE | 2026-11-23 سابق | H2 إجابة Gemini مرتبطة بصفحة في الكورس. T5 وT8 draft/stream/source تحت التحكم | reliability على ملفات ومواضيع مختلفة |
| B3.04 | إجراءات لكل رد | PARTIAL | 2026-11-23 | [StudyChat](../src/components/study/StudyChat.tsx) يعرض مصادر ونسخ وصوت حسب الرد، والـfollow-ups السياقية مجمّعة عند آخر رد | اختبار إجراء من رد أقدم وتحديد نفس الـturn، وTTS حي |
| B3.05 | اقتراحات مرتبطة بالكورس | PARTIAL | 2026-11-23 | S1 وS2. الاقتراح يملأ المسودة وينقل الفوكس، ومصدره outline مخزن | تقليل التكرار وطول النص، وشرح الخطوة التالية |
| B3.06 | PDF source viewer | VERIFIED CONTROLLED | 2026-11-23 جديد | T5 وT8، PDF.js، فتح صفحة 1، highlight، رجوع الـfocus بعد Escape. H1 نفّذ تنزيل الأصل الحقيقي | فحص قارئ شاشة مع PDF معقد أو scanned |
| B3.07 | Quick Quiz | VERIFIED LIVE | 2026-11-23 سابق | H2 توليد وحفظ Quiz حي، T5 sample جاهز، T8 محاولة محفوظة في quiz متحكم فيه | توسيع اختيار الأسئلة المستندة إلى PDF |
| B3.08 | تقييم الإجابات | VERIFIED CONTROLLED | 2026-11-23 جديد | T2 اختبار rubric، وT8 حفظ score. H2 حفظ feedback مربوط بمصدر | مراجعة بشرية لعدة إجابات جزئية وحالات عربية |
| B3.09 | Learning progress | VERIFIED LOCAL | 2026-11-23 جديد | T2 وT8، المحاولة ترجع بعد refresh، accuracy وattempts وcoverage. Sample له تخزين جهاز | قابلية الفهم للطالب وتجربة عبر جهازين على Preview |
| B3.10 | Mastery estimate | NOT IMPLEMENTED | 2026-11-23، مراجعة كود | [Progress](../src/components/workspace.tsx) بيعرض مؤشرات التدريب ورسالة إن تقدير الإتقان يحتاج أدلة | معيار منفصل وعدد أدلة كافٍ ومراجعة تعريف mastery |
| B3.11 | Guided tour | VERIFIED LOCAL | 2026-11-23 جديد | T5، تخطي الجولة وإعادة فتحها يدويًا. T8 focus وaxe في dialog | اختبار فهم الخطوات مع طالب أول مرة |
| B3.12 | Getting-started checklist | PARTIAL | 2026-11-23 جديد | T8 كمل 5/5. [Help](../src/components/learning-help.tsx) يمزج سجل محفوظًا وأفعال الجهاز في [local storage](../src/lib/learning-actions.ts) | فصل إشارات حسابين على نفس الجهاز أو توضيح حالة الجهاز |
| B3.13 | Help | VERIFIED LOCAL | 2026-11-23 جديد | T5 فتح الجولة من Help. S2 جولة عربية | مراجعة نصوص المساعدة حسب أسباب الـ429 |
| B3.14 | Toast notifications | NOT IMPLEMENTED | 2026-11-23، مراجعة كود | فيه inline status/alert في الشاشات وfeedback محلي | UX يحدد أي actions تحتاج toast ويضمن إعلانها |
| B3.15 | Loading skeletons | NOT IMPLEMENTED | 2026-11-23، مراجعة كود | loading بمعالم نصية وprogress، مثل [Course workspace](../src/components/course-workspace.tsx) | skeletons فقط في المواضع اللي يطول انتظارها، مع ضبط CLS |
| B3.16 | Responsive layout | VERIFIED LOCAL | 2026-11-23 جديد | T5 وT8 عند 360، 390، 768، 1024، 1440px | عينات نصوص أطول ومتصفحات أخرى |
| B3.17 | Arabic RTL | VERIFIED LOCAL | 2026-11-23 جديد | T5 تغيير اللغة واتجاه الصفحة؛ T8 رحلة على 390px، 0 browser errors | مراجعة التحرير والمصطلحات ومسار مختلط عربي/إنجليزي |
| B3.18 | English interface | VERIFIED LOCAL | 2026-11-23 جديد | الرحلات الإنجليزية في T5 | مراجعة microcopy الاقتراحات |
| B3.19 | Accessibility | PARTIAL | 2026-11-23 جديد | T8 صفر violations آلية في course/source dialog/tour مع axe، وفتح وإغلاق وترجيع focus | قارئ شاشة يدوي وفحص تباين وزوم وحالات إضافية قبل حكم WCAG |

### معاينة Recovery laboratory — S1

المعاينة لشاشة 390px بعد اختبار Blob الحقيقي السابق، وراجعت توليد الاقتراحات وعرضها في الكود الحالي. [لقطة Recovery laboratory](<C:/Users/asus/.codex/visualizations/2026/11/18/01a1ef54-71d7-77d0-85a6-a4393d1f5e63/FIS Upload Recovery/recovered-mobile.png>)، [صورة جديدة للكورس المتحكم فيه](<C:/Users/asus/.codex/visualizations/2026/11/18/01a1ef54-71d7-77d0-85a6-a4393d1f5e63/FIS Checkpoint Audit/controlled-browser/01-mobile-course-suggestions.png>).

| Finding | Observed | Student impact | Smallest next action |
|---|---|---|---|
| S1.01 | العنوان `Spring Elasticity Laboratory` بيتكرر في 5 من 6 اقتراحات ظاهرة | الاختيارات شكلها متشابه والطالب بيقرا جمل طويلة عشان يفرق | ابدأ بالمفهوم أو بالقياس بدل عنوان الملف |
| S1.02 | `Compare Spring Elasticity Laboratory and Study data for spring force and extension` بيقارن عنوان التجربة بعنوان جزء | الطلب التعليمي نفسه مش واضح، والنص بينزل على سطرين | اربط «قارن» بحالتين فعليين زي الاستطالة عند 1 N و2 N |
| S1.03 | `Explain Study data for spring force and extension` صياغتها قريبة من عنوان منسوخ | مش واضح هل المطلوب تفسير العلاقة ولا قراءة الأرقام | اكتب سؤال مباشر عن العلاقة أو قيمة من المصدر |
| S1.04 | ست اقتراحات طويلة فوق الـcomposer في لقطة الموبايل | كتابة سؤال شخصي أو إرسال الأول محتاج scroll ونقرة إضافية | أظهر 3–4 اختيارات قصيرة، و«أسئلة أكتر» للباقي |
| S1.05 | اختيار الاقتراح يملأ المسودة ويطلب ضغط إرسال. العناوين وحالة Ready مفيهاش شرح للخطوة | الطالب ممكن يفتكر إن الضغط أرسل السؤال | اكتب «اختار سؤال، عدّله لو حابب، وبعدها ابعته» واجعل الـcomposer واضح بعد الاختيار |
| S1.06 | الاختيارات بتبدأ بشرح ومقارنة عامة على نفس العنوان | الإرشاد التعليمي ضعيف في ترتيب البداية والتطبيق | رتّبها بسؤال مفهوم، يليه سؤال من البيانات، يليه تطبيق. أمثلة «إيه اللي بيحصل لطول الزنبرك لما نشيل الحمل؟» و«قارن الاستطالة عند ١ و٢ نيوتن» |

**أقرب خطوة.** اضبط اقتراحات Recovery بالإنجليزي والعربي، اختبر الاختيار والتعديل والإرسال بالكيبورد وعلى 390px، وراجع الصياغة وقابلية فهمها مع طالب أو مراجع تدريس.

## B4 — الإنتاج والأمان والنشر

**الهدف.** نسخة Next.js تتنشر على HTTPS بإعداد واضح، بيانات خاصة معزولة، واستخدام AI محكوم بالخطة المجانية.

**اللي اتبنى.** Prisma migrations، Better Auth، حصص atomically، حفظ وقراءة الملفات بصلاحيات، Vercel config وCI/release workflow. اختبارات الحمل على نسخة production محلية. راجعت Vercel عن طريق GET للـmetadata بس.

**اللي اتأكد.** النسخة المحلية بنت، هجّرت قاعدة جديدة، واختبرت الدخول والعزل والحصص. موجات 5 و10 نجحت بالـfixtures. Vercel Preview فيه اسم Blob token وOpenRouter key. الإنتاج الظاهر في السجل يرجع لنسخة قديمة.

| ID | Feature | Status | Last verification | Evidence | What's missing |
|---|---|---|---|---|---|
| B4.01 | Next.js production build | VERIFIED LOCAL | 2026-11-23 جديد | T4، exit 0 و20 static outputs في الـbuild | remote Preview build لنفس المرجع |
| B4.02 | TypeScript | VERIFIED LOCAL | 2026-11-23 جديد | T3، exit 0 | إعادة CI على revision منشور |
| B4.03 | ESLint | VERIFIED LOCAL | 2026-11-23 جديد | T9، exit 0 | إعادة CI على revision منشور |
| B4.04 | Vitest | VERIFIED LOCAL | 2026-11-23 جديد | T2، ‏84/84 و0 skipped عند تفعيل الـDB | تشغيل CI لنفس revision |
| B4.05 | Playwright | VERIFIED LOCAL | 2026-11-23 جديد | T5، ‏11/11 و0 skipped؛ بعض السيناريوهات بحدود controlled | smoke حقيقي في HTTPS Preview |
| B4.06 | Prisma وpgvector | VERIFIED LOCAL | 2026-11-23 جديد | T1، اتطبقت 2 migrations. T2 وT6 شغّلوا الاستعلامات | migrate وruntime في Neon معزولة |
| B4.07 | Hosted Neon connectivity | BLOCKED | 2026-11-23 metadata | T10، إعداد DB مظهرش لبيئة Preview. [Deployment setup](DEPLOYMENT.md) يسجل انتظار connection من صاحب المشروع | Neon branch معزولة وruntime/migration connection |
| B4.08 | Better Auth | VERIFIED LOCAL | 2026-11-23 جديد | T2 وT5، إنشاء guest، عزل، رفض بدون جلسة، وبيانات اختبار | secret مستقل وorigin HTTPS صحيحين في Preview |
| B4.09 | Private Vercel Blob | VERIFIED LIVE | 2026-11-23 سابق | H1 رفع وقراءة وتنظيف بمخزن Preview. T10 أكد اسم token | نفس التحقق على تطبيق Vercel نفسه |
| B4.10 | User isolation | VERIFIED LOCAL | 2026-11-23 جديد | T2 وT5 حسابان وملكية كورسات، T8 رفض ملف وcitation بـ404 | إعادة matrix الحسابين على HTTPS |
| B4.11 | API security | PARTIAL | 2026-11-23 جديد | T2 وT5 وT8، session وownership وorigin input checks وquota paths؛ [auth](../src/server/auth/session.ts) و[owners](../src/server/db/ownership.ts) | التحقق على HTTPS من cookies وorigin وsigned-out وأنواع الروابط الخاصة |
| B4.12 | Guest quotas | VERIFIED LOCAL | 2026-11-23 جديد | T2 quota windows وatomic writes، T5 مسار retry/sign-in، T8 app 429 المتوقع | حدود البيئة الفعلية وحسابات ضيوف متزامنة على Neon |
| B4.13 | 5-user concurrency | VERIFIED CONTROLLED | 2026-11-23 جديد | T8، ‏5/5. p95 للرحلة 295 ms، لأول token 116 ms. صفر فشل و429 وDB errors داخل الموجة | قياس HTTPS بسقف مزوّد مجاني مصرح به |
| B4.14 | 10-user concurrency | VERIFIED CONTROLLED | 2026-11-23 جديد | T8، ‏10/10. p95 للرحلة 532 ms، لأول token 246 ms. peak fixture streams ‏6؛ صفر فشل و429 وDB errors داخل الموجة | قياس مستقل واقعي للـ10 sessions وقيود المزوّد |
| B4.15 | Live AI reliability | PARTIAL | 2026-11-23 | H2 نجاح Gemini؛ H3 نجاح Groq و429 OpenRouter ومهل بعض Gemini. T8 يثبت التعامل مع الأعطال المحاكية | تكرار حي في أوقات مختلفة وتسجيل timeout/429/TTFT لكل مزوّد |
| B4.16 | Vercel Preview deployment | BLOCKED | 2026-11-23 metadata | T10 جاب 3 deployments قديمة production فقط، وإعدادات Preview للـDB والـauth ناقصة | تجهيز Preview ثم build لنفس commit وURL محفوظ |
| B4.17 | HTTPS smoke tests | BLOCKED | 2026-11-23 metadata | T10، مفيش URL Preview للنسخة 2.0 في السجل المقروء | بعد Preview شغّل رحلة حسابين ورفع واقتباس وQuiz وRTL |
| B4.18 | Production deployment 2.0 | BLOCKED | 2026-11-23 metadata | T10، أحدث `READY` ظاهر على `main` بتاريخ 2026-02-19 وframework `null` | Preview ناجح، إعداد إنتاج منفصل، revision محفوظ، وموافقة نشر |

**أقرب خطوة.** سلّم Neon Preview معزولة وBetter Auth secret وفَعّل مزوّد free مؤهل في البيئة. بعد اعتماد commit، افحص رحلة HTTPS من حسابين.

## اختبارات وأدلة التشغيل

كل أوقات الجدول بتاريخ **2026-11-23** بتوقيت القاهرة. `—` في العد يعني أداة بدون عد حالات pass/fail/skip. الـDB flags شغّالة في T2 وT5، والـAI/Blob متحكم فيهم لما السيناريو يحتاجهما. مخزن الأدلة يحتوي الـstdout ووقت البداية والخروج.

| ID | Exact command | Environment | Start–end (EET) | Passed | Failed | Skipped | Exit/error | Evidence |
|---|---|---|---|---:|---:|---:|---|---|
| T1 | `npm run db:deploy` | Disposable PG/pgvector `fis_acceptance_audit_193945` | 21:39:46–21:39:49 | 2 migrations | 0 | 0 | 0 | [Migration log](<C:/Users/asus/.codex/visualizations/2026/11/18/01a1ef54-71d7-77d0-85a6-a4393d1f5e63/FIS Checkpoint Audit/migration-tests.log>) |
| T2 | `$env:FIS_INTEGRATION_DATABASE='isolated'` ثم `npm test` | نفس القاعدة؛ 12 ملفات Vitest | 21:39:55–21:40:01 | 84 | 0 | 0 | 0؛ تحذير Vite لأسلوب تحميل config في إصدار مستقبلي | [Vitest log](<C:/Users/asus/.codex/visualizations/2026/11/18/01a1ef54-71d7-77d0-85a6-a4393d1f5e63/FIS Checkpoint Audit/vitest.log>) |
| T3 | `npm run typecheck` | Windows وPrisma Client محلي | 21:39:49–21:39:55 | — | — | — | 0 | [Typecheck log](<C:/Users/asus/.codex/visualizations/2026/11/18/01a1ef54-71d7-77d0-85a6-a4393d1f5e63/FIS Checkpoint Audit/typecheck.log>) |
| T4 | `npm run build` | Next.js production محلي | 21:40:02–21:40:15 | — | — | — | 0 | [Build log](<C:/Users/asus/.codex/visualizations/2026/11/18/01a1ef54-71d7-77d0-85a6-a4393d1f5e63/FIS Checkpoint Audit/build.log>) |
| T5 | `$env:FIS_TEST_DB='1'` و`$env:FIS_PLAYWRIGHT_CHANNEL='chrome'` ثم `npm run test:e2e` | Chrome وproduction build محلي، PostgreSQL معزولة وauth اختباري | 21:40:15–21:40:39 | 11 | 0 | 0 | 0؛ تحذير `NO_COLOR` | [Playwright log](<C:/Users/asus/.codex/visualizations/2026/11/18/01a1ef54-71d7-77d0-85a6-a4393d1f5e63/FIS Checkpoint Audit/playwright.log>) |
| T6 | `npm run eval:retrieval` | PostgreSQL/pgvector `fis_retrieval_eval` وembedding/rerank fixtures | 21:40:50–21:40:53 | — | — | — | 0؛ 50 queries لكل strategy | [Retrieval log](<C:/Users/asus/.codex/visualizations/2026/11/18/01a1ef54-71d7-77d0-85a6-a4393d1f5e63/FIS Checkpoint Audit/retrieval.log>) |
| T7 | `node node_modules/tsx/dist/cli.mjs scripts/evaluate-grounding.ts template <audit JSON>` ثم `node node_modules/tsx/dist/cli.mjs scripts/evaluate-grounding.ts score <audit JSON>` | JSON مؤقت، بدون مزوّد | 21:40:50–21:40:51 | 1 فحص رفض متوقع | 0 في الفحص | 0 | scorer رجّع 1 متوقع: `Incomplete answer vector:Q01` | [Grounding validation log](<C:/Users/asus/.codex/visualizations/2026/11/18/01a1ef54-71d7-77d0-85a6-a4393d1f5e63/FIS Checkpoint Audit/grounding-validation.log>) |
| T8 | `npm run db:deploy` ثم `node scripts/check-concurrency.mjs` | `fis_acceptance_audit_load_194121`، Next production، Chrome، axe، AI/Blob fixtures | 21:41:22–21:41:43 | 5/5 و10/10 | 0 | 0 | 0؛ سيناريوهات خارج الموجتين أعادت 429 و504 و422 متوقعين وتحقق الإلغاء | [Concurrency log](<C:/Users/asus/.codex/visualizations/2026/11/18/01a1ef54-71d7-77d0-85a6-a4393d1f5e63/FIS Checkpoint Audit/concurrency.log>) |
| T9 | `npm run lint` | ESLint محلي | 21:39:57–21:40:08 | — | — | — | 0 | [Lint log](<C:/Users/asus/.codex/visualizations/2026/11/18/01a1ef54-71d7-77d0-85a6-a4393d1f5e63/FIS Checkpoint Audit/lint.log>) |
| T10 | `vercel api '/v10/projects/<project>/env?decrypt=false&teamId=<team>' --method GET --raw` و`vercel api '/v6/deployments?projectId=<project>&teamId=<team>' --method GET --raw` | Vercel linked project، GET فقط | 21:40:50–21:40:54 | 2 GETs | 0 | 0 | 0؛ أسماء env وحالة deploy فقط | [Hosted metadata](<C:/Users/asus/.codex/visualizations/2026/11/18/01a1ef54-71d7-77d0-85a6-a4393d1f5e63/FIS Checkpoint Audit/hosted-metadata.log>) |
| T11 | `npm run eval` | محتوى optics جاهز، بدون مزوّد | 21:40:01–21:40:02 | 8 | 0 | 0 | 0؛ 6/6 top match و2/2 بدون مصدر | [Sample evaluation](<C:/Users/asus/.codex/visualizations/2026/11/18/01a1ef54-71d7-77d0-85a6-a4393d1f5e63/FIS Checkpoint Audit/sample-eval.log>) |

تشغيل `npm test` السابق بالإعدادات الافتراضية أعطى 66 Passed و18 Skipped لأن اختبارات الكتابة تحتاج DB fixture مفعّلة. التشغيل الجديد فعّلها وأعاد نتيجة 84 Passed المعروفة سابقًا. محاولة تجهيز قاعدة retrieval بنفس الاسم وجدت قاعدة benchmark المخصصة موجودة بالفعل؛ التقييم استخدم القاعدة المخصصة وخرج 0. استندت مراجعة الـlive inference والـBlob إلى أدلة H1–H3 السابقة؛ حالة quota الحالية غير متحققة، واختبارات المراجعة استخدمت حدودًا محلية متحكم فيها.

| ID | Previous evidence | Date | Result | Boundary |
|---|---|---|---|---|
| H1 | `python scripts/check-upload-recovery.py` | 2026-11-23 | مرتين، Chrome 390px، progress جزئي وانقطاع offline، وبعد refresh نفس document انتقل من `UPLOADING` إلى `READY` والـhash مطابق. اللوج السابق سجل التنظيف | Private Preview Blob حقيقي وapp/DB محليين. الـobject كان اتخزن قبل الانقطاع في المرتين |
| H2 | Local live smoke documented in repository | 2026-11-23 | Gemini stream + محفوظ، مراجعة 2 claims من صفحة 1، رسم من قياسات PDF، وquiz/Progress محفوظ | اختبار وظيفي واحد؛ syntax الأمر الكامل وتوقيت البداية مش محفوظين في التقرير السابق |
| H3 | Earlier provider smoke documented in repository | التاريخ الدقيق غير مسجل | Gemini/Groq نجحا في نص، Gemini رد على صورة وفيديو قصير. تقييم رفع منفصل سجّل live embedding. OpenRouter رجع 429. مفيش TTS حي متحقق | النتائج موزعة على محاولات سابقة، ومفيش سجل حديث لسعة provider |
| H4 | Default Vitest / prior 84 test runs | قبل الـaudit | ‏66 Passed و18 Skipped في الإعداد الافتراضي؛ 84 Passed في تشغيل معزول سابق | T2 أعاد الاختبار كله بتاريخ وتوقيت مثبتين |

### تفسير تقييم RAG

الإعداد في T6 هو 50 سؤالًا على 4 مستندات اصطناعية و16 صفحة، منهم 44 سؤالًا له إجابة و6 بلا إجابة. كل strategy نفذت 50 embedding fixtures، و`liveProviderRequests=0` و`generatedAnswerGroundedness=null`.

| Strategy | Recall@5 | MRR | nDCG@5 | Resolved citations | All direct evidence in Top 5 | Unsupported with zero sources | Local p95 (ms) | Rerank fixture calls |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| vector | 80.68% | 0.88636 | 0.83470 | 59/59 | 34/44 | 4/6 | 8.36 | 0 |
| hybrid | 93.56% | 0.95455 | 0.92486 | 125/125 | 41/44 | 4/6 | 6.00 | 0 |
| hybrid+conditional-rerank | 93.56% | 0.95455 | 0.92732 | 125/125 | 41/44 | 4/6 | 7.41 | 1 |

Recall@5 بيقيس نسبة الدليل المتوقع اللي ظهر ضمن أول خمس نتائج. معدل cross-language ‏95% على 10 أسئلة في الـfixture لكل strategy. في Q47 عن السعر وQ48 عن تاريخ أول طابعة ليزر ظهرت نصوص قريبة لأسئلة المرجع محدد إنها بلا إجابة. فحص الـcitation بيربط `document/page/chunk` بموضع موجود. الـ150 خانة للمراجعة البشرية في T7 لسه محتاجة ردود حقيقية وتقييم الادعاءات والرفض.

## قبل وبعد

المقارنة مع الـHEAD القديم المعتمد في Git. بعض ملفات Express المتعدّلة أثناء الشغل ما زالت موجودة كمرجع للانتقال. [Architecture](ARCHITECTURE.md).

| Dimension | Original HEAD | Current working copy | Where verified |
|---|---|---|---|
| Architecture | Express وواجهات HTML/CSS/JS ثابتة | Next.js/React App Router، Prisma، PostgreSQL/pgvector، private Blob | T1–T5 محلي، H1 للـBlob الحقيقي |
| Chat | محادثة OpenRouter عامة بـSSE، وأدوات للمذاكرة | Tutor داخل الكورس، history محفوظ، citations بمصدر وصفحة وشروحات | H2 Gemini؛ T5 وT8 مسارات controlled |
| Search | بحث على notes مدخلة في المتصفح وميزات دراسة قديمة | استخراج PDF وفهرس دائم مع FTS/vector/hybrid | T2 وT6؛ تقييم grounded answers مفتوح |
| Model selection | اختيار نموذج في الواجهة محفوظ في `fis_model` مع وظائف مزوّد قديم | Gateway تلقائي حسب capability وeligibility مع إعدادات اختيارية | T2 وT8 controlled، H2 وH3 لمزوّدين حقيقيين |
| Quiz | توليد أسئلة من النص في الشات وأدوات مذاكرة | Quick Quiz، rubric ومحاولات محفوظة وtopic coverage | H2 وT2 وT8 |
| Persistence | `fis_conversations` وإعدادات في localStorage | حساب guest أو دائم والبيانات الخاصة في PostgreSQL؛ sample وتنبيهات البدء لها تخزين جهاز | T2 وT5 وT8 محلي |
| UI journey | Chat وواجهات أدوات مجمعة في صفحة ثابتة | Upload-first أو optics sample، workspace وsource وPractice وProgress وHelp | T5 وT8. ملاحظات جودة Recovery في S1 |

## لوحة الشغل من الأدلة المفتوحة

الصفوف `READY CODE` يمكن البدء فيها بعد انتهاء تجميد التنفيذ. كل صف يوضح نوع الاعتماد، وقد يحتاج أكثر من فئة.

| ID | Priority | Task | Current blocker | Required implementation | Required test | Definition of Done | Dependencies / readiness |
|---|---|---|---|---|---|---|---|
| A01 | P0 | حفظ revision مطابق للإصدار | التطبيق والمهاجرات والاختبارات خارج Git HEAD | راجع ملفات الإصدار وافصل مخلفات الشغل واحتفظ بالمرجع الموافق عليه | clean checkout ثم install وتحقق CI والـbuild | revision محفوظ يعيد بناء نفس التطبيق والاختبارات | NEW CODE, HUMAN REVIEW، جاهز للمراجعة بعد فك التجميد |
| A02 | P0 | تجهيز Preview معزولة | Neon connection وBetter Auth secret وfree eligibility للبيئة ناقصين | وفّر Neon/pgvector وruntime/migration connections وauth origin وprivate store والإعدادات المجانية | migrate + sign-in + storage boundary checks | إعداد Preview متسق والبيانات منفصلة وcredentials خارج اللوج | CREDENTIALS, HOSTED INFRASTRUCTURE, HUMAN REVIEW |
| A03 | P0 | نشر ومراجعة HTTPS Preview | A01 وA02 + مفيش URL للنسخة | شغّل workflow لإصدار Preview بعد الإذن | حسابان، PDF أكبر من 4 MiB، citations، Quiz، Progress، RTL، quota/error | رابط HTTPS مصحوب بدليل رحلة ناجحة وعزل وبيانات اختبار قابلة للتنظيف | HOSTED INFRASTRUCTURE, CREDENTIALS, HUMAN REVIEW؛ يعتمد على A01–A02 |
| A04 | P1 | تأكيد استئناف upload لو الـobject غايب | Live السابق وصل لفرع object موجود | سيناريو يقطع قبل commit ويثبت 409 ثم retry بنفس reservation؛ وسيناريو Cancel منفصل | Chrome + private test Blob + SHA-256 | نفس document وjob و`READY` وhash مطابق بعد retry، وتسجيل cancel | READY CODE, CREDENTIALS, HOSTED INFRASTRUCTURE |
| A05 | P1 | مراجعة Grounding ورفض الأسئلة | 150 review slots غير مملوءة؛ Q47/Q48 رجعتا مصادر قريبة | شغّل generation من أدلة كل strategy، وسجل الادعاءات والرفض، وراجعهم مع مراجع محتوى | score كامل مع فحص corpus والادعاءات والـcitations | تقرير قابل للإعادة بالأعداد لكل strategy ونتيجة Q47/Q48 وأي محدودية | HUMAN REVIEW, EXTERNAL PROVIDER AVAILABILITY؛ الـscorer موجود |
| A06 | P1 | قياس اعتمادية Gemini/Groq/OpenRouter المجانية | 429 سابق وعدم وجود قياس خارجي متكرر | smoke محدود في مواعيد مختلفة، سجل eligibility وRetry-After وTTFT | طلب Tutor صغير لكل مزوّد مؤهل، ومعاينة fallback المصرح به | الحالة وسقف كل مزوّد منشوران بأدلة، وأي capability غير مؤهل غير معروض كمتاح | EXTERNAL PROVIDER AVAILABILITY, CREDENTIALS, HOSTED INFRASTRUCTURE |
| A07 | P1 | إصلاح اقتراحات Recovery laboratory | اقتراحات متكررة وطويلة وخطوة الإرسال غير واضحة | 3–4 أسئلة مباشرة مختلفة، توضيح draft/send، مرجعية concepts وmeasurements | EN/AR، 390px و1440px، keyboard، مراجعة مدرس أو طالب | مفيش عنوان متكرر في الأفعال؛ كل اختيار بيفهم الطالب يعمل إيه | READY CODE, HUMAN REVIEW |
| A08 | P2 | استكمال actions وchecklist وa11y | الـfollow-ups عند آخر رد، وبعض checklist للجهاز، وتغطية a11y آلية محدودة | اربط الإجراء بالرد، وقيّد progress للحساب، وأصلح المشاكل اليدوية المؤكدة | حالتا حساب على جهاز واحد، قارئ شاشة، focus، zoom | كل إجراء يشتغل في الرد المقصود وحالة القائمة تخص الحساب ونطاق accessibility موثق | READY CODE, HUMAN REVIEW |
| A09 | P2 | ضبط تجربة Progress والتحميل | صياغة الإتقان ورسائل انتظار بسيطة | عرّف mastery مع evidence threshold، وأضف skeletons أو إعلان الحالة للمواضع المطلوبة | حد أدنى للدليل، حالات انتظار وفشل، قارئ شاشة وCLS | تقدير أو حالة دليل غير كافي، مع حالة انتظار معلنة ومقروءة | READY CODE بعد HUMAN REVIEW لتعريف mastery |
| A10 | P3 | اعتماد voice وillustration live | مفيش smoke TTS أو illustration فعلي | اعرض الـcapability لما eligible وتأكد من الصور والصوت المدعومين | استجابة حية لنموذج مؤهل وfixture للفشل واختبار الأجهزة | نتيجة حية محفوظة لكل capability المعروضة وحدود مكتوبة | EXTERNAL PROVIDER AVAILABILITY, CREDENTIALS |

### رابط الـCV

ينفع تعرض نسخة محلية ولقطات أو فيديو من رحلة optics أو من اختبار حي محدد، مع تسمية البيئة بالفعل. عشان تحط رابط 2.0 عام ومتحقق منه، خلّص A01–A03. لو هتعرض Tutor كميزة أساسية، خلّص مراجعة الـgrounding والـprovider smoke من A05–A06، واستخدم PDF اصطناعي في الديمو. الـPreview خطوة تحقق، والإنتاج له DB وBlob وauth منفصلين وموافقة نشر بعد نجاح التحقق.
