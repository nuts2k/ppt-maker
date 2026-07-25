import { CHECK_DOT_CLASS, type DoctorNotice } from "@/lib/doctor-view";
import { cn } from "@/lib/utils";

/**
 * 环境提示条 —— 启动提示与导出前警告共用同一条形式。
 *
 * 选条形而非模态：DESIGN.md 没有模态语言，且 PRD 要求提示「不阻止打开」；
 * 条形贴在顶栏下方，与导出结果条同处一列，视觉上是同一类系统反馈。
 * 右侧动作由调用方给出（启动提示只需「知道了」，导出警告需要二选一）。
 */

interface DoctorNoticeBarProps {
  readonly notice: DoctorNotice;
  readonly actions: React.ReactNode;
}

export function DoctorNoticeBar({
  notice,
  actions,
}: DoctorNoticeBarProps): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex items-start gap-4 border-t border-hairline px-6 py-3",
        notice.level === "fail"
          ? "bg-signature-coral/10"
          : "bg-signature-mustard/10",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="text-sm font-medium text-ink">{notice.title}</p>
        <ul className="flex flex-col gap-1">
          {notice.items.map((item) => (
            <li key={item.id} className="flex items-start gap-2">
              <span
                className={cn(
                  "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                  CHECK_DOT_CLASS[item.status],
                )}
              />
              <span className="min-w-0 text-sm text-body">
                {item.label}：{item.message}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">{notice.hint}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">{actions}</div>
    </div>
  );
}
