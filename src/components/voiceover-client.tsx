'use client'

import { useMemo, useRef, useState, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  AudioLines,
  Download,
  Timer,
  FileAudio,
  Layers,
  Gauge,
  Mic2,
  Play,
} from 'lucide-react'

export interface SegmentRow {
  idx: number
  start: number
  end: number
  target: number
  final_duration: number
  prosody_speed: number
  atempo: number
  action: string
  text: string
}

export interface FitReport {
  total_duration: number
  sample_rate: number
  bitrate_kbps: number
  loudness_gain_db: number
  input_lufs: number
  segments: SegmentRow[]
}

export function fmtTC(t: number): string {
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  const ss = s.toFixed(3).padStart(6, '0')
  return `${h}:${String(m).padStart(2, '0')}:${ss}`
}

export function fmtDur(t: number): string {
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}

export function VoiceoverClient({
  report,
  fileSizeMB,
}: {
  report: FitReport
  fileSizeMB: string
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)

  const stats = useMemo(() => {
    const segs = report.segments
    const asIs = segs.filter((s) => s.action.startsWith('as-is')).length
    const atempo = segs.filter((s) => s.action.includes('atempo') && !s.action.includes('regen')).length
    const regen = segs.filter((s) => s.action.startsWith('regenerated') || s.action.includes('regen speed')).length
    return { asIs, atempo, regen, count: segs.length }
  }, [report])

  const seekTo = useCallback((t: number, idx: number) => {
    const el = audioRef.current
    if (!el) return
    el.currentTime = Math.max(0, t - 0.25)
    setActiveIdx(idx)
    void el.play()
  }, [])

  const handleTimeUpdate = useCallback(() => {
    const el = audioRef.current
    if (!el) return
    const t = el.currentTime
    const seg = report.segments.find((s) => t >= s.start - 0.05 && t < s.end)
    setActiveIdx(seg ? seg.idx : null)
  }, [report])

  return (
    <div className="min-h-screen flex flex-col bg-stone-50 text-stone-900">
      {/* Header */}
      <header className="border-b border-stone-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 flex flex-wrap items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
            <AudioLines className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold tracking-tight leading-tight">
              English Voice-Over — Final Master
            </h1>
            <p className="text-sm text-stone-500 leading-tight">
              Fish Audio TTS · synchronized to screen recording timestamps
            </p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Badge variant="outline" className="border-emerald-300 text-emerald-700 bg-emerald-50">
              <Mic2 className="h-3 w-3 mr-1" aria-hidden="true" />
              voice 12a852…c1e0
            </Badge>
            <Badge variant="outline" className="border-stone-300 text-stone-600">
              s2.1-pro-free
            </Badge>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Player card */}
        <Card className="border-stone-200 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Play className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Single continuous track — ready to place under your screen recording
            </CardTitle>
            <CardDescription>
              Every segment starts at its exact timestamp. Gaps are preserved as silence.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <audio
              ref={audioRef}
              controls
              preload="metadata"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={handleTimeUpdate}
              className="w-full"
              aria-label="Final voice-over audio player"
              src="/voiceover_final.mp3"
            />

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                {
                  icon: <Timer className="h-4 w-4 text-emerald-600" aria-hidden="true" />,
                  label: 'Duration',
                  value: fmtDur(report.total_duration),
                  sub: 'matches 0:06:52.280 timeline',
                },
                {
                  icon: <Layers className="h-4 w-4 text-emerald-600" aria-hidden="true" />,
                  label: 'Segments',
                  value: String(stats.count),
                  sub: 'placed at exact offsets',
                },
                {
                  icon: <FileAudio className="h-4 w-4 text-emerald-600" aria-hidden="true" />,
                  label: 'Format',
                  value: `MP3 ${report.bitrate_kbps}k`,
                  sub: `${report.sample_rate / 1000} kHz · mono`,
                },
                {
                  icon: <Gauge className="h-4 w-4 text-emerald-600" aria-hidden="true" />,
                  label: 'Loudness',
                  value: `${report.final_lufs.toFixed(1)} LUFS`,
                  sub: `gain ${report.loudness_gain_db > 0 ? '+' : ''}${report.loudness_gain_db.toFixed(1)} dB · TP ${report.final_tp_dbtp.toFixed(2)} dBTP`,
                },
              ].map((it) => (
                <div key={it.label} className="rounded-lg border border-stone-200 bg-white p-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-stone-500">
                    {it.icon}
                    {it.label}
                  </div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">{it.value}</div>
                  <div className="text-[11px] text-stone-400 leading-snug">{it.sub}</div>
                </div>
              ))}
            </div>

            <Separator />

            <div className="flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="bg-emerald-600 hover:bg-emerald-700 text-white">
                <a href="/voiceover_final.mp3" download="voiceover_final.mp3">
                  <Download className="h-4 w-4 mr-2" aria-hidden="true" />
                  Download final MP3 ({fileSizeMB} MB)
                </a>
              </Button>
              <p className="text-xs text-stone-500">
                44.1 kHz · 128 kbps CBR · loudness-normalized · starts at 0:00:00.880, ends 0:06:52.280
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Fit summary */}
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="secondary" className="bg-stone-200 text-stone-700">
            {stats.asIs} segments at natural speed 1.0
          </Badge>
          <Badge variant="secondary" className="bg-amber-100 text-amber-800">
            {stats.atempo} fitted with micro tempo adjust
          </Badge>
          <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">
            {stats.regen} regenerated with prosody speed
          </Badge>
        </div>

        {/* Segment table */}
        <Card className="border-stone-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Timeline & segment fitting report</CardTitle>
            <CardDescription>
              Click any row to jump the player to that timestamp. Text is word-for-word from your script.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-96 overflow-y-auto rounded-lg border border-stone-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-stone-100 text-stone-600 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left font-medium px-3 py-2 w-10">#</th>
                    <th className="text-left font-medium px-3 py-2 w-44">Timecode</th>
                    <th className="text-left font-medium px-3 py-2 w-16">Fit</th>
                    <th className="text-left font-medium px-3 py-2">Script text</th>
                  </tr>
                </thead>
                <tbody>
                  {report.segments.map((s) => (
                    <tr
                      key={s.idx}
                      onClick={() => seekTo(s.start, s.idx)}
                      className={`cursor-pointer border-t border-stone-100 transition-colors hover:bg-emerald-50/70 ${
                        activeIdx === s.idx ? 'bg-emerald-100/80' : 'bg-white'
                      }`}
                    >
                      <td className="px-3 py-2 text-stone-400 tabular-nums">{s.idx + 1}</td>
                      <td className="px-3 py-2 tabular-nums text-stone-700 whitespace-nowrap">
                        {fmtTC(s.start)}
                        <span className="text-stone-400"> → {fmtTC(s.end)}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
                            s.prosody_speed > 1
                              ? 'bg-emerald-100 text-emerald-800'
                              : s.atempo > 1
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-stone-100 text-stone-500'
                          }`}
                          title={s.action}
                        >
                          {s.prosody_speed > 1 ? `×${s.prosody_speed}` : s.atempo > 1 ? `${s.atempo.toFixed(2)}×` : '1.0×'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-stone-700 leading-snug">{s.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
            <p className="mt-3 text-xs text-stone-400">
              The 11.36 s pause at 0:05:53.280 → 0:06:04.639 present in the script is preserved as silence.
            </p>
          </CardContent>
        </Card>
      </main>

      <footer className="mt-auto border-t border-stone-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
          <p>
            Generated with Fish Audio TTS API · model <span className="font-medium">s2.1-pro-free</span> · reference voice{' '}
            <span className="font-mono">12a85233597842b6a4e169c3db4ec1e0</span>
          </p>
          <p>{playing ? '● playing' : '57 segments · one continuous MP3'}</p>
        </div>
      </footer>
    </div>
  )
}
