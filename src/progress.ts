import { Notice } from "obsidian";
import { t } from "./lang/helpers";

/** Counts actual upload tasks, independently of the number of note references. */
export class UploadProgress {
  private notice: Notice;
  private timer: ReturnType<typeof setTimeout>;
  private closed = false;
  private completed = 0;
  private failed = 0;

  constructor(private label: string, private total: number, private release: () => void) {
    this.notice = new Notice(this.message(t("Uploading")), 0);
  }

  private message(stage: string) {
    return `${this.label}\n${stage}\n${t("Files completed")} ${this.completed}/${this.total}, ${t("Success")} ${this.completed - this.failed}, ${t("Failed")} ${this.failed}`;
  }
  stage(stage: string) { if (!this.closed) this.notice.setMessage(this.message(stage)); }
  complete(success: boolean) {
    this.completed++;
    if (!success) this.failed++;
    this.stage(t("Uploading"));
  }
  finish(summary: string) {
    if (this.closed) return;
    this.notice.setMessage(`${this.label}\n${summary}`);
    this.timer = setTimeout(() => this.close(), 6000);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.notice.hide();
    this.release();
  }
}
