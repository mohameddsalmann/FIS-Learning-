import { SampleCourse } from "@/components/sample-course";
import { getLanguage } from "@/lib/server-locale";

export default async function SampleCoursePage() {
  return <SampleCourse lang={await getLanguage()} />;
}
