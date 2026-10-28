import { copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter'

/**
 * With E2E_VIDEO=1 (playwright.config.ts): every video of the run is copied
 * to e2e/videos/<date time>/<project> - <test>/<name>.webm, under readable
 * names, to download or send. "video" is the test's own page, "cửa sổ N" the
 * windows it opened (support/fixtures.ts). Each run gets its own folder;
 * nothing older is deleted.
 */
const VIDEOS_DIR = path.join(import.meta.dirname, '..', 'videos')

// Windows refuses <>:"/\|?* in names; long titles are cut.
const safeName = (text: string) => text.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100)

const stamp = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

export default class VideoReporter implements Reporter {
  private runDir = path.join(VIDEOS_DIR, stamp(new Date()))
  private copied = 0

  onTestEnd(test: TestCase, result: TestResult) {
    const videos = result.attachments.filter((a) => a.contentType === 'video/webm' && a.path)
    if (videos.length === 0) return
    const project = test.parent.project()?.name ?? ''
    const dir = path.join(this.runDir, safeName(`${project} - ${test.title}`))
    mkdirSync(dir, { recursive: true })
    for (const video of videos) {
      copyFileSync(video.path!, path.join(dir, `${safeName(video.name)}.webm`))
      this.copied += 1
    }
  }

  onEnd() {
    if (this.copied > 0) console.log(`\n${this.copied} video đã lưu ở ${this.runDir}`)
  }

  printsToStdio() {
    return false
  }
}
