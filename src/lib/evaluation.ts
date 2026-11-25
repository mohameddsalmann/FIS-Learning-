import { findSampleSources, type sampleLessons } from "./sample";
import type { Language } from "./locale";

const fixture: ReadonlyArray<{ language: Language; query: string; expected: ReturnType<typeof sampleLessons>[number]["id"] | null }> = [
  { language:"en",query:"At what angle is light reflected by a mirror?",expected:"reflection" },
  { language:"en",query:"Does light change speed when it enters glass?",expected:"refraction" },
  { language:"en",query:"Why does a prism produce a spectrum?",expected:"dispersion" },
  { language:"ar",query:"كيف نقيس زاوية السقوط في المرآة؟",expected:"reflection" },
  { language:"ar",query:"هل تتغير السرعة عند انتقال الضوء إلى الزجاج؟",expected:"refraction" },
  { language:"ar",query:"كيف يفصل المنشور الضوء الأبيض إلى ألوان؟",expected:"dispersion" },
  { language:"en",query:"Where is the Sahara desert?",expected:null },
  { language:"ar",query:"ما عاصمة المغرب؟",expected:null },
];

export function evaluatePreparedRetrieval() {
  let found=0, reciprocal=0, abstentions=0, grounded=0;
  const start=performance.now();
  const rows = fixture.map(({ language,query,expected }) => {
    const actual=findSampleSources(query,language).map((source)=>source.id);
    if (expected) {
      const rank=actual.indexOf(expected)+1;
      if(rank){found++;reciprocal+=1/rank;}
      if(actual[0]===expected) grounded++;
    } else if(!actual.length) abstentions++;
    return {language,query,expected,actual};
  });
  const positive = fixture.filter(({expected})=>expected!==null).length;
  return {
    rows, positive, negative: fixture.length-positive, found, recallAt2:found/positive,
    mrr:reciprocal/positive, topCitationMatches:grounded, abstentions, elapsedMs:performance.now()-start,
  };
}
