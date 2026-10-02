"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AudioLines,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  Eraser,
  FileAudio,
  FileSearch,
  ListMusic,
  Loader2,
  Play,
  RotateCcw,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import {
  DEFAULT_API_KEY,
  DEFAULT_REFERENCE_ID,
  FISH_CONFIG,
  type CreateJobResponse,
  type JobDTO,
  type ParseResponse,
  type SegmentDTO,
  formatMs,
  formatShort,
} from "@/lib/dubbing/types";

const EXAMPLE_SCRIPT = `[0:00:00.880] Almost all of us just use Claude as a chatbot. But today, I want to see what happens
[0:00:06.759] when I let Claude run a complete creative workflow by itself. I'll give Claude Opus 5.5 a simple idea,
[0:00:14.320] connect it to Higgsfield through MCP, and let it plan the project and render
[0:00:20.160] the content, review the results, and fix everything by itself.
[0:00:28.080] For the Higgsfield MCP link, all you have to do is click the link I'll leave in the description
[0:00:34.280] and in the first comment. Click Connect Higgsfield. It'll take you to the Higgsfield page
[0:00:41.440] for your account. Then just click Allow. And that's it. You've connected Higgsfield MCP to Claude.
[0:00:50.840] Now let's give it the full prompt. Then I'll hit Send right here,
[0:00:57.359] and it'll start calling the MCP inside Higgsfield. It'll start working on the project,
[0:00:57.359] and it'll start calling the MCP inside Higgsfield,
[0:01:03.920] planning it, reviewing it by itself, and creating a complete cinematic project for me.
[0:06:52.280]`;

type JobStatusValue = JobDTO["status"];

function JobStatusBadge({ status }: { status: JobStatusValue }) {
  if (status === "processing") {
    return (
      <Badge className="border-amber-200 bg-amber-100 text-amber-800 hover:bg-amber-100">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        جاري التوليد…
      </Badge>
    );
  }
  if (status === "done") {
    return (
      <Badge className="border-emerald-200 bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
        مكتمل
      </Badge>
    );
  }
  if (status === "error") {
    return <Badge variant="destructive">فشل</Badge>;
  }
  if (status === "cancelled") {
    return <Badge variant="secondary">أُلغي</Badge>;
  }
  return <Badge variant="secondary">في الانتظار</Badge>;
}

function SegmentStatusIcon({ status }: { status: SegmentDTO["status"] }) {
  switch (status) {
    case "done":
      return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />;
    case "failed":
      return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />;
    case "generating":
    case "fitting":
      return (
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-amber-600" aria-hidden />
      );
    default:
      return <Clock className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" aria-hidden />;
  }
}

export function DubbingStudio() {
  // Script + parse state
  const [script, setScript] = useState("");
  const [parsed, setParsed] = useState<ParseResponse | null>(null);
  const [parsedScript, setParsedScript] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  // Settings
  const [apiKey, setApiKey] = useState(DEFAULT_API_KEY);
  const [referenceId, setReferenceId] = useState(DEFAULT_REFERENCE_ID);
  const [prosodySpeed, setProsodySpeed] = useState(1);
  const [concurrency, setConcurrency] = useState(3);
  const [settingsOpen, setSettingsOpen] = useState(true);

  // Job state
  const [starting, setStarting] = useState(false);
  const [busyAction, setBusyAction] = useState<"cancel" | "retry" | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobDTO | null>(null);
  const [pollNonce, setPollNonce] = useState(0);

  // Delete state
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeRowRef = useRef<HTMLDivElement | null>(null);
  const doneToastRef = useRef(false);
  const errorToastRef = useRef(false);
  const pollFailuresRef = useRef(0);
  const deletingRef = useRef(false);

  const parsedSegments = parsed?.segments ?? [];
  const scriptChangedAfterParse = parsed !== null && parsedScript !== script;
  const canGenerate = parsedSegments.length >= 1 && !scriptChangedAfterParse;

  // ---- Polling (1500ms while queued/processing) ----
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      if (stopped) return;
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as JobDTO;
        if (stopped) return;
        pollFailuresRef.current = 0;
        setJob(data);
        if (data.status === "done" && !doneToastRef.current) {
          doneToastRef.current = true;
          toast.success("تم إنشاء الملف الصوتي بنجاح");
        }
        if (data.status === "error" && !errorToastRef.current) {
          errorToastRef.current = true;
          toast.error(data.error ?? "فشل التوليد — يمكنك المحاولة من جديد");
        }
        if (data.status === "queued" || data.status === "processing") {
          timer = setTimeout(() => void poll(), 1500);
        }
      } catch {
        if (stopped || deletingRef.current) return;
        pollFailuresRef.current += 1;
        if (pollFailuresRef.current === 3) {
          toast.error("تعذر تحديث حالة المهمة — جاري إعادة المحاولة");
        }
        if (pollFailuresRef.current < 8) {
          timer = setTimeout(() => void poll(), 1500);
        }
      }
    };

    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, pollNonce]);

  // ---- Restore the most recent job on first mount (survives page reloads) ----
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/jobs/latest", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean;
          job?: JobDTO | null;
        } | null;
        if (!data?.ok || !data.job) return;
        setJobId(data.job.id);
        setJob(data.job);
        doneToastRef.current = data.job.status === "done";
        errorToastRef.current = data.job.status === "error";
        if (data.job.status === "done") {
          toast.info("تم استعادة آخر مهمة مكتملة — يمكنك تشغيل الملف أو تحميله");
        } else if (data.job.status === "processing" || data.job.status === "queued") {
          toast.info("تم استعادة مهمة قيد المعالجة — متابعة التقدم");
        }
      } catch {
        /* silent — restoring is best-effort */
      }
    })();
  }, []);

  // ---- Auto-scroll to the active (generating/fitting) segment row ----
  useEffect(() => {
    if (activeRowRef.current) {
      activeRowRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [job?.segments]);

  // ---- Handlers ----
  const runParse = async (
    value: string
  ): Promise<ParseResponse | null> => {
    const res = await fetch("/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script: value }),
    });
    const data = (await res.json().catch(() => null)) as ParseResponse | null;
    if (!res.ok || !data || !data.ok) {
      throw new Error(data?.error ?? `تعذر تحليل السكريبت (HTTP ${res.status})`);
    }
    setParsed(data);
    setParsedScript(value);
    return data;
  };

  const handleParse = async () => {
    if (!script.trim()) {
      toast.error("الصق السكريبت أولًا");
      return;
    }
    setParsing(true);
    try {
      const data = await runParse(script);
      toast.success(`تم تحليل ${data?.segments?.length ?? 0} مقطع`);
    } catch (e) {
      setParsed(null);
      setParsedScript(null);
      toast.error(e instanceof Error ? e.message : "تعذر تحليل السكريبت");
    } finally {
      setParsing(false);
    }
  };

  const handleExample = () => {
    setScript(EXAMPLE_SCRIPT);
    setParsed(null);
    setParsedScript(null);
  };

  const handleClear = () => {
    setScript("");
    setParsed(null);
    setParsedScript(null);
  };

  const handleGenerate = async () => {
    if (starting) return;
    setStarting(true);
    try {
      // Auto-parse first so one click is enough (explicit preview still available)
      if (!canGenerate) {
        if (!script.trim()) {
          toast.error("الصق السكريبت أولًا");
          return;
        }
        setParsing(true);
        try {
          const data = await runParse(script);
          toast.success(`تم تحليل ${data?.segments?.length ?? 0} مقطع`);
        } finally {
          setParsing(false);
        }
      }
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, apiKey, referenceId, prosodySpeed, concurrency }),
      });
      const data = (await res.json().catch(() => null)) as CreateJobResponse | null;
      if (!res.ok || !data || !data.ok || !data.jobId) {
        throw new Error(data?.error ?? `تعذر إنشاء المهمة (HTTP ${res.status})`);
      }
      doneToastRef.current = false;
      errorToastRef.current = false;
      pollFailuresRef.current = 0;
      setJob(null);
      setJobId(data.jobId);
      toast.success("بدأت عملية التوليد — تابِع الحالة من لوحة التقدم");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر إنشاء المهمة");
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async () => {
    if (!jobId || busyAction) return;
    setBusyAction("cancel");
    try {
      const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      if (data && data.ok === false) throw new Error("refused");
      toast.info("تم إرسال طلب الإيقاف — سيتم إلغاء المهمة حالًا");
    } catch (e) {
      toast.error(e instanceof Error ? `تعذر إيقاف المهمة (${e.message})` : "تعذر إيقاف المهمة");
    } finally {
      setBusyAction(null);
    }
  };

  const handleRetry = async () => {
    if (!jobId || busyAction) return;
    setBusyAction("retry");
    try {
      const res = await fetch(`/api/jobs/${jobId}/retry`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      if (data && data.ok === false) throw new Error("refused");
      toast.info("جاري إعادة المحاولة");
      doneToastRef.current = false;
      errorToastRef.current = false;
      pollFailuresRef.current = 0;
      setJob((prev) => (prev ? { ...prev, status: "queued", error: null } : prev));
      setPollNonce((n) => n + 1);
    } catch (e) {
      toast.error(e instanceof Error ? `تعذر إعادة المحاولة (${e.message})` : "تعذر إعادة المحاولة");
    } finally {
      setBusyAction(null);
    }
  };

  const handleDelete = async () => {
    if (!jobId || deleting) return;
    setDeleting(true);
    deletingRef.current = true; // silence polling errors while the job is being removed
    try {
      const res = await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok || !data || data.ok !== true) {
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      // Reset everything so a brand-new project can be started immediately
      setConfirmDeleteOpen(false);
      setJob(null);
      setJobId(null);
      setBusyAction(null);
      doneToastRef.current = false;
      errorToastRef.current = false;
      pollFailuresRef.current = 0;
      toast.success("تم حذف المشروع بنجاح — يمكنك البدء من جديد");
    } catch (e) {
      toast.error(
        e instanceof Error ? `تعذر حذف المشروع (${e.message})` : "تعذر حذف المشروع"
      );
      setConfirmDeleteOpen(false);
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  const seekTo = (ms: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = ms / 1000;
    void el.play().catch(() => undefined);
  };

  const parsedWarnings = parsed?.warnings ?? [];
  const firstStartMs = parsedSegments.length > 0 ? parsedSegments[0].startMs : null;
  const totalEndMs = parsed?.totalEndMs ?? null;

  const jobActive = job?.status === "queued" || job?.status === "processing";
  const progressPct =
    job && job.totalSegments > 0
      ? Math.min(100, Math.round((job.doneCount / job.totalSegments) * 100))
      : 0;

  return (
    <div dir="rtl" lang="ar" className="flex min-h-screen flex-col bg-stone-100">
      <Toaster richColors position="top-center" />

      {/* Header */}
      <header className="border-b border-stone-200 bg-stone-50">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-5 sm:py-6">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-sm">
            <AudioLines className="h-6 w-6" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-stone-900 sm:text-2xl">
                استوديو الدبلجة الآلي
              </h1>
              <Badge
                variant="outline"
                className="border-emerald-200 bg-emerald-50 text-emerald-700"
              >
                <span dir="ltr" className="font-mono text-[11px]">
                  Fish Audio · s2.1-pro-free
                </span>
              </Badge>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-stone-500">
              الصق السكريبت بالفواصل الزمنية — سيتم توليد الصوت لكل مقطع وتركيبه على الخط الزمني
              بدقة، ثم دمج كل شيء في ملف MP3 واحد
            </p>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-start gap-6 px-4 py-6 lg:grid-cols-5">
          {/* Left column: script + settings + generate */}
          <div className="space-y-6 lg:col-span-3">
            {/* Script card */}
            <Card className="border-stone-200 bg-white">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileSearch className="h-4 w-4 text-emerald-600" aria-hidden />
                  السكريبت
                </CardTitle>
                <CardDescription className="text-xs leading-relaxed">
                  صيغ مدعومة:{" "}
                  <span dir="ltr" className="font-mono">
                    [0:00:00.880] text…
                  </span>{" "}
                  ·{" "}
                  <span dir="ltr" className="font-mono">
                    [0:00:00.880 - 0:00:06.759] text…
                  </span>{" "}
                  ·{" "}
                  <span dir="ltr" className="font-mono">
                    0:00:00.599,0:00:07.960
                  </span>{" "}
                  ·{" "}
                  <span dir="ltr" className="font-mono">
                    0:00:00.880 text…
                  </span>{" "}
                  · SRT
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="narration-script">نص التعليق الصوتي بالفواصل الزمنية</Label>
                  <Textarea
                    id="narration-script"
                    dir="ltr"
                    value={script}
                    onChange={(e) => setScript(e.target.value)}
                    placeholder={"[0:00:00.880] Almost all of us just use Claude as a chatbot.\n0:00:06.759,0:00:14.320\nwhen I let Claude run a complete creative workflow by itself…"}
                    spellCheck={false}
                    className="min-h-[280px] resize-y bg-white font-mono text-xs leading-relaxed text-stone-800 placeholder:text-stone-400"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void handleParse()}
                    disabled={parsing || !script.trim()}
                  >
                    {parsing ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <FileSearch className="h-4 w-4" aria-hidden />
                    )}
                    تحليل السكريبت
                  </Button>
                  <Button type="button" variant="ghost" onClick={handleExample}>
                    <Sparkles className="h-4 w-4" aria-hidden />
                    مثال
                  </Button>
                  <Button type="button" variant="ghost" onClick={handleClear}>
                    <Eraser className="h-4 w-4" aria-hidden />
                    مسح
                  </Button>
                </div>

                {scriptChangedAfterParse && (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    تم تعديل السكريبت بعد آخر تحليل — أعد الضغط على «تحليل السكريبت» قبل بدء التوليد.
                  </p>
                )}

                {parsed && !scriptChangedAfterParse && (
                  <div className="space-y-3">
                    {/* Summary chips */}
                    <div className="flex flex-wrap gap-2">
                      <Badge
                        variant="outline"
                        className="border-stone-300 bg-stone-50 text-stone-700"
                      >
                        المقاطع: {parsedSegments.length}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="border-stone-300 bg-stone-50 text-stone-700"
                      >
                        بداية أول مقطع:{" "}
                        <span dir="ltr" className="font-mono">
                          {firstStartMs != null ? formatMs(firstStartMs) : "—"}
                        </span>
                      </Badge>
                      <Badge
                        variant="outline"
                        className="border-stone-300 bg-stone-50 text-stone-700"
                      >
                        نهاية الخط الزمني:{" "}
                        <span dir="ltr" className="font-mono">
                          {totalEndMs != null ? formatMs(totalEndMs) : "—"}
                        </span>
                      </Badge>
                    </div>

                    {parsedWarnings.length > 0 && (
                      <Alert className="border-amber-200 bg-amber-50 text-amber-900">
                        <TriangleAlert className="text-amber-600" aria-hidden />
                        <AlertTitle>تنبيهات التحليل</AlertTitle>
                        <AlertDescription>
                          <ul className="list-inside list-disc space-y-0.5 text-xs">
                            {parsedWarnings.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Segments preview */}
                    <ScrollArea className="max-h-80 rounded-md border border-stone-200">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-stone-50 hover:bg-stone-50">
                            <TableHead className="w-10 text-center">#</TableHead>
                            <TableHead className="w-28">البداية</TableHead>
                            <TableHead className="w-32">النافذة</TableHead>
                            <TableHead>النص</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {parsedSegments.map((seg) => (
                            <TableRow key={seg.idx}>
                              <TableCell className="text-center font-mono text-xs text-stone-400">
                                {seg.idx + 1}
                              </TableCell>
                              <TableCell>
                                <span dir="ltr" className="font-mono text-xs text-stone-700">
                                  {formatMs(seg.startMs)}
                                </span>
                              </TableCell>
                              <TableCell>
                                <span dir="ltr" className="font-mono text-xs text-stone-500">
                                  {seg.windowEndMs != null ? formatMs(seg.windowEndMs) : "—"}
                                </span>
                              </TableCell>
                              <TableCell>
                                <div
                                  className="max-w-[280px] truncate text-xs text-stone-500"
                                  title={seg.text}
                                >
                                  {seg.text || "—"}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Settings card */}
            <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen} asChild>
              <Card className="border-stone-200 bg-white">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Settings2 className="h-4 w-4 text-emerald-600" aria-hidden />
                    <CardTitle className="text-base">الإعدادات</CardTitle>
                  </div>
                  <CollapsibleTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      aria-label={settingsOpen ? "إخفاء الإعدادات" : "إظهار الإعدادات"}
                    >
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 transition-transform",
                          settingsOpen && "rotate-180"
                        )}
                        aria-hidden
                      />
                    </Button>
                  </CollapsibleTrigger>
                </div>
                <CardDescription className="text-xs">
                  مفتاح API والصوت المرجعي وسرعة النطق — القيم الافتراضية جاهزة للاستخدام
                </CardDescription>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="api-key">مفتاح Fish Audio API</Label>
                      <Input
                        id="api-key"
                        type="password"
                        dir="ltr"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        className="bg-white font-mono text-xs"
                        autoComplete="off"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reference-id">المعرف المرجعي (Reference ID)</Label>
                      <Input
                        id="reference-id"
                        dir="ltr"
                        value={referenceId}
                        onChange={(e) => setReferenceId(e.target.value)}
                        className="bg-white font-mono text-xs"
                        autoComplete="off"
                      />
                    </div>

                    <Separator className="bg-stone-200" />

                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor="prosody-speed">سرعة النطق الأساسية</Label>
                        <Badge
                          variant="outline"
                          dir="ltr"
                          className="border-stone-300 bg-stone-50 font-mono text-xs text-stone-700"
                        >
                          ×{prosodySpeed.toFixed(2)}
                        </Badge>
                      </div>
                      <Slider
                        id="prosody-speed"
                        aria-label="سرعة النطق الأساسية"
                        value={[prosodySpeed]}
                        onValueChange={(v) => setProsodySpeed(v[0] ?? 1)}
                        min={0.5}
                        max={2}
                        step={0.05}
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor="concurrency">التوليد المتوازي</Label>
                        <Badge
                          variant="outline"
                          dir="ltr"
                          className="border-stone-300 bg-stone-50 font-mono text-xs text-stone-700"
                        >
                          {concurrency}
                        </Badge>
                      </div>
                      <Slider
                        id="concurrency"
                        aria-label="التوليد المتوازي"
                        value={[concurrency]}
                        onValueChange={(v) => setConcurrency(v[0] ?? 3)}
                        min={1}
                        max={5}
                        step={1}
                      />
                    </div>

                    <p className="text-xs leading-relaxed text-stone-500">
                      ثابتة:{" "}
                      <span dir="ltr" className="font-mono">
                        temperature {FISH_CONFIG.temperature} · top_p {FISH_CONFIG.topP} · MP3
                        44.1kHz mono · 128kbps
                      </span>{" "}
                      · تسريع تلقائي عند التجاوز · ضبط رنانة −16 LUFS
                    </p>
                </CardContent>
              </CollapsibleContent>
              </Card>
            </Collapsible>

            {/* Generate card */}
            <Card className="border-stone-200 bg-white">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Play className="h-4 w-4 text-emerald-600" aria-hidden />
                  التوليد
                </CardTitle>
                <CardDescription className="text-xs">
                  يتم توليد كل مقطع بصوتك المرجعي، وملاءمته لنافذته الزمنية تلقائيًا، ثم دمج
                  المقاطع كلها في ملف MP3 واحد
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  type="button"
                  onClick={() => void handleGenerate()}
                  disabled={starting || parsing}
                  className="h-12 w-full bg-emerald-600 text-base text-white hover:bg-emerald-700"
                >
                  {starting || parsing ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                  ) : (
                    <Play className="h-5 w-5" aria-hidden />
                  )}
                  {starting || parsing ? "جاري التحضير…" : "بدء التوليد"}
                </Button>
                {!script.trim() && (
                  <p className="mt-2 text-center text-xs text-stone-400">
                    الصق السكريبت ثم اضغط الزر — يتم التحليل والتوليد تلقائيًا
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right column: progress + result */}
          <div className="space-y-6 lg:col-span-2">
            {/* Progress card */}
            {jobId && (
              <Card className="border-stone-200 bg-white">
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Activity className="h-4 w-4 text-emerald-600" aria-hidden />
                      التقدم
                    </CardTitle>
                    <div className="flex items-center gap-1.5">
                      {job ? (
                        <JobStatusBadge status={job.status} />
                      ) : (
                        <Badge variant="secondary">
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                          تحميل…
                        </Badge>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setConfirmDeleteOpen(true)}
                        disabled={deleting}
                        aria-label="حذف المشروع"
                        title="حذف المشروع نهائيًا"
                        className="h-8 w-8 text-stone-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  </div>
                  <CardDescription className="text-xs">
                    توليد المقاطع وملاءمتها للنوافذ الزمنية ثم الدمج النهائي
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div role="status" className="space-y-2">
                    <div dir="ltr">
                      <Progress
                        value={progressPct}
                        className="bg-stone-200 [&>[data-slot=progress-indicator]]:bg-emerald-600"
                        aria-label="نسبة إنجاز التوليد"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs text-stone-600">
                      <span>
                        مقطع {job?.doneCount ?? 0} من {job?.totalSegments ?? 0}
                      </span>
                      <span dir="ltr" className="font-mono">
                        {progressPct}%
                      </span>
                    </div>
                    {job && job.failedCount > 0 && (
                      <p className="text-xs text-red-600">مقاطع فاشلة: {job.failedCount}</p>
                    )}
                    {job?.status === "error" && job.error && (
                      <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
                        {job.error}
                      </p>
                    )}
                  </div>

                  {(jobActive || job?.status === "error") && (
                    <div className="flex flex-wrap gap-2">
                      {jobActive && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleCancel()}
                          disabled={busyAction !== null}
                          className="border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
                        >
                          {busyAction === "cancel" ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          ) : (
                            <Square className="h-4 w-4" aria-hidden />
                          )}
                          إيقاف
                        </Button>
                      )}
                      {job?.status === "error" && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleRetry()}
                          disabled={busyAction !== null}
                          className="border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
                        >
                          {busyAction === "retry" ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          ) : (
                            <RotateCcw className="h-4 w-4" aria-hidden />
                          )}
                          إعادة المحاولة
                        </Button>
                      )}
                    </div>
                  )}

                  {job && (
                    <div className="space-y-1.5">
                      <p className="flex items-center gap-1.5 text-xs font-medium text-stone-500">
                        <ListMusic className="h-3.5 w-3.5" aria-hidden />
                        المقاطع ({job.segments.length})
                      </p>
                      <ScrollArea className="max-h-96 rounded-md border border-stone-200 bg-stone-50/50">
                        <div className="divide-y divide-stone-100 px-2 py-1">
                          {job.segments.map((seg) => {
                            const active =
                              seg.status === "generating" || seg.status === "fitting";
                            return (
                              <div
                                key={seg.idx}
                                ref={active ? activeRowRef : undefined}
                                className={cn(
                                  "flex items-start gap-2 px-1.5 py-2",
                                  active && "rounded-md bg-amber-50"
                                )}
                              >
                                <span
                                  dir="ltr"
                                  className="w-8 shrink-0 pt-0.5 text-right font-mono text-xs text-stone-400"
                                >
                                  {seg.idx + 1}
                                </span>
                                <span
                                  dir="ltr"
                                  className="w-[86px] shrink-0 pt-0.5 font-mono text-xs text-stone-500"
                                >
                                  {formatMs(seg.startMs)}
                                </span>
                                <SegmentStatusIcon status={seg.status} />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-xs text-stone-700" title={seg.text}>
                                    {seg.text || "—"}
                                  </p>
                                  {seg.status === "done" && (
                                    <p className="mt-0.5 text-xs text-stone-500">
                                      <span dir="ltr" className="font-mono">
                                        {seg.durationMs != null
                                          ? formatShort(seg.durationMs)
                                          : "—"}
                                      </span>
                                      {seg.windowEndMs != null && (
                                        <span dir="ltr" className="font-mono text-stone-400">
                                          {" / "}
                                          {((seg.windowEndMs - seg.startMs) / 1000).toFixed(1)}s
                                        </span>
                                      )}
                                    </p>
                                  )}
                                  {seg.error && (
                                    <p className="mt-0.5 text-xs text-red-600">{seg.error}</p>
                                  )}
                                  {seg.note && (
                                    <p
                                      className="mt-0.5 truncate text-xs text-stone-400"
                                      title={seg.note}
                                    >
                                      {seg.note}
                                    </p>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Result card */}
            {jobId && job?.status === "done" && (
              <Card className="border-stone-200 bg-white">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileAudio className="h-4 w-4 text-emerald-600" aria-hidden />
                    النتيجة
                  </CardTitle>
                  <CardDescription className="text-xs">
                    الملف النهائي المدموج — جاهز للتحميل أو التشغيل مباشرة
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <audio
                    ref={audioRef}
                    controls
                    preload="metadata"
                    className="w-full"
                    src={`/api/jobs/${jobId}/audio`}
                  />

                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-stone-500">المدة النهائية</span>
                    <span dir="ltr" className="font-mono text-sm text-stone-700">
                      {job.totalDurationMs != null ? formatMs(job.totalDurationMs) : "—"}
                    </span>
                  </div>

                  <Button
                    asChild
                    className="h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    <a href={`/api/jobs/${jobId}/audio?dl=1`} download>
                      <Download className="h-4 w-4" aria-hidden />
                      تحميل MP3
                    </a>
                  </Button>

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-stone-500">
                      الخط الزمني — انقر أي مقطع للانتقال إليه
                    </p>
                    <div
                      dir="ltr"
                      className="relative h-14 overflow-hidden rounded-md bg-stone-200"
                    >
                      {(() => {
                        const total = job.totalDurationMs ?? 0;
                        if (total <= 0) return null;
                        return job.segments.map((seg) => {
                          const leftPct = (seg.startMs / total) * 100;
                          const rawWidthMs = Math.max(
                            (seg.windowEndMs ?? seg.durationMs ?? 500) - seg.startMs,
                            300
                          );
                          const widthPct = Math.min(
                            (rawWidthMs / total) * 100,
                            100 - leftPct
                          );
                          if (widthPct <= 0) return null;
                          return (
                            <div
                              key={seg.idx}
                              role="button"
                              tabIndex={0}
                              title={`#${seg.idx + 1} · ${formatMs(seg.startMs)}`}
                              aria-label={`الانتقال إلى المقطع ${seg.idx + 1} عند ${formatMs(seg.startMs)}`}
                              onClick={() => seekTo(seg.startMs)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  seekTo(seg.startMs);
                                }
                              }}
                              className="absolute top-3 h-8 cursor-pointer rounded-sm bg-emerald-500/70 transition-colors hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
                              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                            />
                          );
                        });
                      })()}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {!jobId && (
              <Card className="border-dashed border-stone-300 bg-white/60">
                <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
                  <AudioLines className="h-8 w-8 text-stone-300" aria-hidden />
                  <p className="text-sm font-medium text-stone-500">لا توجد مهمة بعد</p>
                  <p className="text-xs leading-relaxed text-stone-400">
                    حلّل السكريبت واضغط «بدء التوليد» وستظهر هنا حالة التقدم والنتيجة النهائية
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-stone-200 bg-stone-50 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 py-4 text-xs text-stone-500 sm:flex-row">
          <p>يعمل بـ Fish Audio TTS · MP3 واحد نهائي 44.1kHz · 128kbps</p>
          <a
            href="/voiceover_final.mp3"
            className="underline decoration-stone-300 underline-offset-4 transition-colors hover:text-emerald-700"
          >
            نتيجة المشروع السابق (6:52)
          </a>
        </div>
      </footer>

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={confirmDeleteOpen}
        onOpenChange={(open) => {
          if (!deleting) setConfirmDeleteOpen(open);
        }}
      >
        <AlertDialogContent dir="rtl" lang="ar" className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-right">حذف المشروع المحفوظ؟</AlertDialogTitle>
            <AlertDialogDescription className="text-right leading-relaxed">
              سيتم إيقاف التوليد إن كان قيد المعالجة، وحذف جميع الملفات والبيانات الخاصة بهذا
              المشروع نهائيًا — لا يمكن التراجع. بعد الحذف يمكنك لصق سكريبت جديد والبدء من جديد.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2 sm:flex-row-reverse">
            <AlertDialogCancel disabled={deleting}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={deleting}
              className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="h-4 w-4" aria-hidden />
              )}
              حذف نهائي
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default DubbingStudio;
