import { useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Modal,
  TextInput,
  Switch,
  Alert,
  useWindowDimensions,
} from "react-native";
import Svg, { Polyline } from "react-native-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { gradebookStats, averageTrend } from "@astra/shared";
import type { ExamRecord, ExamRecordInput } from "@astra/shared";
import { api } from "../lib/api";

// The student's private gradebook. Everything here is self-only: the app talks
// to /api/me/gradebook, which never exposes another student's records.
//
// The averages come from @astra/shared so Home can show the same numbers.
// Exchange/MSc selection-score estimates are deliberately still absent.

const STATUSES = [
  { value: "PLANNED", label: "Planned" },
  { value: "PASSED", label: "Passed" },
] as const;

const YEAR_LABEL = ["", "First year", "Second year", "Third year", "Fourth year", "Fifth year", "Sixth year"];

type Draft = {
  id: string | null;
  courseId: string | null;
  courseLabel: string | null;
  customTitle: string;
  credits: string;
  studyYear: number;
  semester: string | null;
  status: (typeof STATUSES)[number]["value"];
  grade: string;
  lode: boolean;
  passFail: boolean;
  examDate: string;
  notes: string;
};

const emptyDraft = (studyYear: number): Draft => ({
  id: null,
  courseId: null,
  courseLabel: null,
  customTitle: "",
  credits: "6",
  studyYear,
  semester: null,
  status: "PLANNED",
  grade: "",
  lode: false,
  passFail: false,
  examDate: "",
  notes: "",
});

const draftFrom = (record: ExamRecord): Draft => ({
  id: record.id,
  courseId: record.course?.id ?? null,
  courseLabel: record.course ? `${record.course.code} · ${record.course.title}` : null,
  customTitle: record.customTitle ?? "",
  credits: String(record.credits),
  studyYear: record.studyYear,
  semester: record.semester,
  status: record.status,
  grade: record.grade == null ? "" : String(record.grade),
  lode: record.lode,
  passFail: record.passFail,
  examDate: record.examDate ? record.examDate.slice(0, 10) : "",
  notes: record.notes ?? "",
});

function gradeLabel(record: ExamRecord): string | null {
  if (record.passFail) return record.status === "PASSED" ? "Pass" : null;
  if (record.grade == null) return null;
  return record.lode ? "30L" : String(record.grade);
}

/** How the average has moved, one point per dated graded exam. */
function TrendLine({ points }: { points: { date: string; average: number }[] }) {
  const { width } = useWindowDimensions();
  const W = width - 40 - 32; // screen px-5 (2×20) + card p-4 (2×16)
  const H = 56;
  // A flat run would divide by zero; a one-point span is drawn as a flat line.
  const values = points.map((p) => p.average);
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const line = points
    .map((p, i) => {
      const x = (W * i) / Math.max(1, points.length - 1);
      const y = 4 + (1 - (p.average - min) / span) * (H - 8);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <Svg width={W} height={H}>
      <Polyline points={line} fill="none" stroke="#04107E" strokeWidth={2} strokeLinejoin="round" />
    </Svg>
  );
}

/**
 * The student's own numbers, computed from their own records — deliberately
 * not called a transcript, and no selection-score estimate in sight.
 */
function Summary({ records }: { records: ExamRecord[] }) {
  const stats = useMemo(() => gradebookStats(records), [records]);
  const trend = useMemo(() => averageTrend(records), [records]);

  return (
    <View className="mx-5 mt-5 rounded-2xl bg-gray-50 p-4">
      <Text className="text-xs font-semibold uppercase tracking-wide text-gray-400">
        Weighted average
      </Text>
      <View className="flex-row items-end gap-2">
        <Text className="text-3xl font-semibold text-astra-primary">
          {stats.weightedAverage?.toFixed(2) ?? "—"}
        </Text>
        <Text className="pb-1.5 text-xs text-gray-400">
          {stats.gradedCredits > 0
            ? `over ${stats.gradedCredits} graded credits`
            : "no graded exams yet"}
        </Text>
      </View>

      {/* Only worth a line when a modular course is still half-done. */}
      {stats.completedCourseAverage !== stats.weightedAverage ? (
        <Text className="mt-0.5 text-xs text-gray-500">
          {stats.completedCourseAverage?.toFixed(2) ?? "—"} counting only the modular courses
          you've finished
        </Text>
      ) : null}

      {trend.length > 1 ? <TrendLine points={trend} /> : null}

      <View className="mt-3 flex-row justify-between border-t border-gray-200 pt-3">
        {[
          { label: "Credits", value: stats.earnedCredits },
          { label: "Passed", value: stats.passedCount },
          { label: "Planned", value: stats.plannedCount },
        ].map((cell) => (
          <View key={cell.label} className="items-center">
            <Text className="text-base font-semibold text-gray-900">{cell.value}</Text>
            <Text className="text-[10px] uppercase tracking-wide text-gray-400">{cell.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function GradebookScreen() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), retry: false });
  const gradebook = useQuery({
    queryKey: ["gradebook"],
    queryFn: () => api.gradebook.list(),
    retry: 1,
  });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentYear = me.data?.academicProfile?.studyYear ?? 1;

  const save = useMutation({
    mutationFn: async (input: ExamRecordInput & { id: string | null }) => {
      const { id, ...body } = input;
      return id ? api.gradebook.update(id, body) : api.gradebook.create(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gradebook"] });
      setDraft(null);
      setError(null);
    },
    onError: (err: Error) => setError(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.gradebook.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gradebook"] });
      setDraft(null);
    },
    onError: (err: Error) => setError(err.message),
  });

  // Year → semester → records, in the order a student thinks about them.
  const grouped = useMemo(() => {
    const byYear = new Map<number, Map<string, ExamRecord[]>>();
    for (const record of gradebook.data?.records ?? []) {
      const semester = record.semester ?? "—";
      if (!byYear.has(record.studyYear)) byYear.set(record.studyYear, new Map());
      const bySem = byYear.get(record.studyYear)!;
      if (!bySem.has(semester)) bySem.set(semester, []);
      bySem.get(semester)!.push(record);
    }
    return [...byYear.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([year, bySem]) => [year, [...bySem.entries()].sort((a, b) => a[0].localeCompare(b[0]))] as const);
  }, [gradebook.data]);

  function submit() {
    if (!draft) return;
    const credits = Number(draft.credits);
    if (!Number.isInteger(credits) || credits < 1) {
      setError("Credits must be a whole number.");
      return;
    }
    const graded = draft.status === "PASSED" && !draft.passFail;
    const grade = graded ? Number(draft.grade) : null;
    if (graded && (!Number.isInteger(grade) || grade! < 18 || grade! > 30)) {
      setError("A passed exam needs a grade between 18 and 30.");
      return;
    }
    if (draft.examDate && !/^\d{4}-\d{2}-\d{2}$/.test(draft.examDate)) {
      setError("Exam date must look like 2026-06-15.");
      return;
    }
    save.mutate({
      id: draft.id,
      courseId: draft.courseId,
      customTitle: draft.courseId ? null : draft.customTitle.trim(),
      credits,
      studyYear: draft.studyYear,
      semester: draft.semester,
      status: draft.status,
      grade,
      lode: grade === 30 ? draft.lode : false,
      passFail: draft.passFail,
      examDate: draft.examDate ? new Date(`${draft.examDate}T00:00:00.000Z`).toISOString() : null,
      notes: draft.notes.trim() || null,
    });
  }

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
      <View className="flex-row items-center gap-2 border-b border-gray-100 px-4 py-3">
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color="#04107E" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-lg font-semibold text-astra-primary">Gradebook</Text>
          <Text className="text-xs text-gray-400">Your exams — private to you</Text>
        </View>
        <Pressable
          onPress={() => {
            setError(null);
            setDraft(emptyDraft(currentYear));
          }}
          className="flex-row items-center gap-1 rounded-full bg-astra-primary px-3 py-1.5 active:opacity-80"
        >
          <Ionicons name="add" size={15} color="#fff" />
          <Text className="text-xs font-semibold text-white">Add exam</Text>
        </Pressable>
      </View>

      {gradebook.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#04107E" />
        </View>
      ) : gradebook.isError ? (
        <View className="flex-1 items-center justify-center gap-2 px-8">
          <Ionicons name="cloud-offline-outline" size={28} color="#9CA3AF" />
          <Text className="text-center text-gray-500">Couldn't load your gradebook.</Text>
          <Pressable
            onPress={() => gradebook.refetch()}
            className="mt-2 rounded-full bg-astra-primary px-5 py-2"
          >
            <Text className="font-medium text-white">Retry</Text>
          </Pressable>
        </View>
      ) : grouped.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-3 px-8">
          <Ionicons name="book-outline" size={30} color="#9CA3AF" />
          <Text className="text-center text-gray-600">
            No exams yet. Add the ones you've planned or already taken.
          </Text>
          <Pressable
            onPress={() => setDraft(emptyDraft(currentYear))}
            className="mt-1 rounded-full bg-astra-primary px-5 py-2"
          >
            <Text className="font-medium text-white">Add your first exam</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerClassName="pb-16">
          <Summary records={gradebook.data?.records ?? []} />
          {grouped.map(([year, semesters]) => (
            <View key={year} className="px-5 pt-5">
              <Text className="text-lg font-semibold text-gray-900">
                {YEAR_LABEL[year] ?? `Year ${year}`}
              </Text>
              {semesters.map(([semester, records]) => (
                <View key={semester} className="mt-3">
                  <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {semester === "—" ? "No semester" : `Semester ${semester}`}
                  </Text>
                  {records.map((record) => (
                    <Pressable
                      key={record.id}
                      onPress={() => {
                        setError(null);
                        setDraft(draftFrom(record));
                      }}
                      className="mb-2 flex-row items-center gap-3 rounded-2xl border border-gray-100 p-3.5 active:bg-gray-50"
                    >
                      <View className="flex-1">
                        <Text className="text-base font-medium text-gray-900" numberOfLines={2}>
                          {record.course ? record.course.title : record.customTitle}
                        </Text>
                        <Text className="mt-0.5 text-xs text-gray-500">
                          {record.course ? `${record.course.code} · ` : ""}
                          {record.credits} credits
                          {record.examDate ? ` · ${record.examDate.slice(0, 10)}` : ""}
                        </Text>
                      </View>
                      <View className="items-end">
                        {gradeLabel(record) ? (
                          <Text className="text-lg font-semibold text-astra-primary">
                            {gradeLabel(record)}
                          </Text>
                        ) : null}
                        <Text className="text-[10px] uppercase tracking-wide text-gray-400">
                          {STATUSES.find((s) => s.value === record.status)?.label}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      )}

      {draft ? (
        <ExamSheet
          draft={draft}
          setDraft={setDraft}
          error={error}
          saving={save.isPending}
          onSubmit={submit}
          onDelete={
            draft.id
              ? () =>
                  Alert.alert("Delete exam", "This removes the record from your gradebook.", [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: () => remove.mutate(draft.id!),
                    },
                  ])
              : null
          }
        />
      ) : null}
    </SafeAreaView>
  );
}

function ExamSheet({
  draft,
  setDraft,
  error,
  saving,
  onSubmit,
  onDelete,
}: {
  draft: Draft;
  setDraft: (draft: Draft | null) => void;
  error: string | null;
  saving: boolean;
  onSubmit: () => void;
  onDelete: (() => void) | null;
}) {
  const [search, setSearch] = useState("");
  const [allProgrammes, setAllProgrammes] = useState(false);
  const patch = (values: Partial<Draft>) => setDraft({ ...draft, ...values });

  const courses = useQuery({
    queryKey: ["courses", search, allProgrammes],
    queryFn: () => api.academic.courses({ q: search, all: allProgrammes }),
    enabled: !draft.courseId && search.trim().length >= 2,
  });

  const graded = draft.status === "PASSED" && !draft.passFail;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDraft(null)}>
      <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
        <View className="flex-row items-center justify-between border-b border-gray-100 px-4 py-3">
          <Pressable onPress={() => setDraft(null)} hitSlop={10}>
            <Text className="text-base text-gray-500">Cancel</Text>
          </Pressable>
          <Text className="text-base font-semibold text-astra-primary">
            {draft.id ? "Edit exam" : "Add exam"}
          </Text>
          <Pressable onPress={onSubmit} disabled={saving} hitSlop={10}>
            <Text className={`text-base font-semibold ${saving ? "text-gray-300" : "text-astra-primary"}`}>
              Save
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerClassName="px-5 pb-12 pt-4 gap-4" keyboardShouldPersistTaps="handled">
          {error ? (
            <View className="rounded-xl bg-red-50 px-3 py-2">
              <Text className="text-sm text-red-600">{error}</Text>
            </View>
          ) : null}

          {/* Course: pick from the official catalogue, or type your own. */}
          <View>
            <Label>Course</Label>
            {draft.courseId ? (
              <View className="flex-row items-center gap-2 rounded-xl bg-astra-light px-3 py-3">
                <Text className="flex-1 text-sm text-astra-primary">{draft.courseLabel}</Text>
                <Pressable onPress={() => patch({ courseId: null, courseLabel: null })} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color="#04107E" />
                </Pressable>
              </View>
            ) : (
              <>
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search by code or title"
                  placeholderTextColor="#9CA3AF"
                  autoCapitalize="characters"
                  className="rounded-xl border border-gray-200 px-3 py-3 text-base text-gray-900"
                />
                <Pressable
                  onPress={() => setAllProgrammes(!allProgrammes)}
                  className="mt-2 flex-row items-center gap-2"
                >
                  <Ionicons
                    name={allProgrammes ? "checkbox" : "square-outline"}
                    size={16}
                    color="#04107E"
                  />
                  <Text className="text-xs text-gray-500">
                    Search outside my programme (electives, exchange)
                  </Text>
                </Pressable>
                {courses.isFetching ? (
                  <ActivityIndicator className="mt-3" color="#04107E" />
                ) : null}
                {(courses.data?.courses ?? []).slice(0, 8).map((course) => (
                  <Pressable
                    key={course.id}
                    onPress={() =>
                      patch({
                        courseId: course.id,
                        courseLabel: `${course.code} · ${course.title}`,
                        customTitle: "",
                        credits: String(course.credits),
                        semester: course.semester ?? draft.semester,
                      })
                    }
                    className="mt-2 rounded-xl border border-gray-100 px-3 py-2.5 active:bg-gray-50"
                  >
                    <Text className="text-sm font-medium text-gray-900" numberOfLines={2}>
                      {course.title}
                    </Text>
                    <Text className="text-xs text-gray-500">
                      {course.code} · {course.credits} credits
                      {course.semester ? ` · sem ${course.semester}` : ""}
                    </Text>
                  </Pressable>
                ))}
                <Text className="mt-3 text-xs text-gray-400">
                  Not in the catalogue? Give it a title instead.
                </Text>
                <TextInput
                  value={draft.customTitle}
                  onChangeText={(customTitle) => patch({ customTitle })}
                  placeholder="e.g. Exchange: Game Theory"
                  placeholderTextColor="#9CA3AF"
                  className="mt-1 rounded-xl border border-gray-200 px-3 py-3 text-base text-gray-900"
                />
              </>
            )}
          </View>

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Label>Credits</Label>
              <TextInput
                value={draft.credits}
                onChangeText={(credits) => patch({ credits })}
                keyboardType="number-pad"
                className="rounded-xl border border-gray-200 px-3 py-3 text-base text-gray-900"
              />
            </View>
            <View className="flex-1">
              <Label>Exam date</Label>
              <TextInput
                value={draft.examDate}
                onChangeText={(examDate) => patch({ examDate })}
                placeholder="2026-06-15"
                placeholderTextColor="#9CA3AF"
                className="rounded-xl border border-gray-200 px-3 py-3 text-base text-gray-900"
              />
            </View>
          </View>

          <View>
            <Label>Year</Label>
            <View className="flex-row flex-wrap gap-2">
              {[1, 2, 3, 4, 5].map((year) => (
                <Chip
                  key={year}
                  label={`Year ${year}`}
                  active={draft.studyYear === year}
                  onPress={() => patch({ studyYear: year })}
                />
              ))}
            </View>
          </View>

          <View>
            <Label>Semester</Label>
            <View className="flex-row flex-wrap gap-2">
              {["I", "II", "I/II"].map((semester) => (
                <Chip
                  key={semester}
                  label={semester}
                  active={draft.semester === semester}
                  onPress={() => patch({ semester: draft.semester === semester ? null : semester })}
                />
              ))}
            </View>
          </View>

          <View>
            <Label>Status</Label>
            <View className="flex-row flex-wrap gap-2">
              {STATUSES.map((status) => (
                <Chip
                  key={status.value}
                  label={status.label}
                  active={draft.status === status.value}
                  onPress={() => patch({ status: status.value })}
                />
              ))}
            </View>
          </View>

          <View className="flex-row items-center justify-between">
            <Text className="text-sm text-gray-700">Pass/fail (no grade)</Text>
            <Switch
              value={draft.passFail}
              onValueChange={(passFail) => patch({ passFail, grade: "", lode: false })}
            />
          </View>

          {graded ? (
            <View className="flex-row items-end gap-3">
              <View className="flex-1">
                <Label>Grade</Label>
                <TextInput
                  value={draft.grade}
                  onChangeText={(grade) => patch({ grade, lode: grade === "30" && draft.lode })}
                  keyboardType="number-pad"
                  placeholder="18–30"
                  placeholderTextColor="#9CA3AF"
                  className="rounded-xl border border-gray-200 px-3 py-3 text-base text-gray-900"
                />
              </View>
              {draft.grade === "30" ? (
                <View className="flex-1 flex-row items-center justify-between pb-3">
                  <Text className="text-sm text-gray-700">Lode</Text>
                  <Switch value={draft.lode} onValueChange={(lode) => patch({ lode })} />
                </View>
              ) : null}
            </View>
          ) : null}

          <View>
            <Label>Notes</Label>
            <TextInput
              value={draft.notes}
              onChangeText={(notes) => patch({ notes })}
              multiline
              className="min-h-20 rounded-xl border border-gray-200 px-3 py-3 text-base text-gray-900"
            />
          </View>

          {onDelete ? (
            <Pressable
              onPress={onDelete}
              className="mt-2 flex-row items-center justify-center gap-2 rounded-xl border-2 border-red-500 px-4 py-3 active:bg-red-50"
            >
              <Ionicons name="trash-outline" size={17} color="#DC2626" />
              <Text className="font-semibold text-red-600">Delete exam</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const Label = ({ children }: { children: string }) => (
  <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
    {children}
  </Text>
);

const Chip = ({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) => (
  <Pressable
    onPress={onPress}
    className={`rounded-full px-3 py-1.5 ${active ? "bg-astra-primary" : "bg-astra-light"}`}
  >
    <Text className={`text-xs font-semibold ${active ? "text-white" : "text-astra-primary"}`}>
      {label}
    </Text>
  </Pressable>
);
