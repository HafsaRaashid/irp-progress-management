import { getCurrentUserOrRedirect } from "@/lib/api-client";
import { StudentToday } from "./student-today";
import { MentorToday } from "./mentor-today";

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ batchId?: string }>;
}) {
  const user = await getCurrentUserOrRedirect();
  if (user.role === "Student") {
    return <StudentToday displayName={user.displayName} role={user.role} />;
  }
  const { batchId } = await searchParams;
  return (
    <MentorToday
      displayName={user.displayName}
      role={user.role}
      {...(batchId !== undefined && { batchId })}
    />
  );
}
