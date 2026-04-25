import jsPDF from "jspdf";
import html2canvas from "html2canvas";

export type ReportParticipant = {
  userId: string;
  username: string;
  email: string;
  wasModerator: boolean;
  roles: string[];
  sessions: { joinedAt: string; leftAt: string | null }[];
  totalMs: number;
};

export type RoomReport = {
  room: {
    id: string;
    name: string;
    slug: string;
    createdAt: string;
    closedAt: string | null;
    durationMs: number;
    owner: { id: string; username: string };
  };
  peakConcurrent: number;
  participants: ReportParticipant[];
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0 мин";
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  return `${minutes} мин`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildReportNodeHtml(report: RoomReport): string {
  const { room, peakConcurrent, participants } = report;

  const participantRows = participants
    .map((p) => {
      const firstJoin = p.sessions[0]?.joinedAt ?? null;
      const lastLeave =
        [...p.sessions].reverse().find((s) => s.leftAt)?.leftAt ?? null;
      const isOwner = p.userId === room.owner.id || p.roles.includes("OWNER");
      const roleLabel = isOwner
        ? "Владелец"
        : p.roles.includes("MODERATOR")
        ? "Модератор"
        : "Участник";
      return `
      <tr>
        <td>${escapeHtml(p.username)}</td>
        <td>${roleLabel}</td>
        <td style="text-align:center">${p.sessions.length}</td>
        <td>${formatDateTime(firstJoin)}</td>
        <td>${formatDateTime(lastLeave)}</td>
        <td>${formatDuration(p.totalMs)}</td>
      </tr>`;
    })
    .join("");

  return `
    <div style="font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color:#111; padding:32px; width:794px; background:#fff; box-sizing:border-box;">
      <h1 style="font-size:26px; margin:0 0 8px; color:#7c3aed;">Отчёт о конференции</h1>
      <div style="font-size:13px; color:#555; margin-bottom:24px;">VOCO · сформировано ${formatDateTime(new Date().toISOString())}</div>

      <dl style="display:grid; grid-template-columns:200px 1fr; gap:6px 16px; font-size:13px; border:1px solid #e5e7eb; border-radius:10px; padding:16px 20px; margin:0 0 24px;">
        <dt style="color:#555; font-weight:500; margin:0;">Название</dt><dd style="margin:0; font-weight:600;">${escapeHtml(room.name || "—")}</dd>
        <dt style="color:#555; font-weight:500; margin:0;">Код комнаты</dt><dd style="margin:0; font-weight:600;">${escapeHtml(room.slug)}</dd>
        <dt style="color:#555; font-weight:500; margin:0;">Владелец</dt><dd style="margin:0; font-weight:600;">${escapeHtml(room.owner.username)}</dd>
        <dt style="color:#555; font-weight:500; margin:0;">Начало</dt><dd style="margin:0; font-weight:600;">${formatDateTime(room.createdAt)}</dd>
        <dt style="color:#555; font-weight:500; margin:0;">Завершение</dt><dd style="margin:0; font-weight:600;">${formatDateTime(room.closedAt)}</dd>
        <dt style="color:#555; font-weight:500; margin:0;">Длительность</dt><dd style="margin:0; font-weight:600;">${formatDuration(room.durationMs)}</dd>
        <dt style="color:#555; font-weight:500; margin:0;">Пик одновременных</dt><dd style="margin:0; font-weight:600;">${peakConcurrent}</dd>
        <dt style="color:#555; font-weight:500; margin:0;">Всего уникальных участников</dt><dd style="margin:0; font-weight:600;">${participants.length}</dd>
      </dl>

      <h2 style="font-size:16px; margin:16px 0 8px;">Участники</h2>
      <table style="width:100%; border-collapse:collapse; font-size:12px;">
        <thead>
          <tr>
            <th style="background:#7c3aed; color:#fff; text-align:left; padding:8px 10px; font-weight:600;">Ник</th>
            <th style="background:#7c3aed; color:#fff; text-align:left; padding:8px 10px; font-weight:600;">Роль</th>
            <th style="background:#7c3aed; color:#fff; text-align:left; padding:8px 10px; font-weight:600;">Сессий</th>
            <th style="background:#7c3aed; color:#fff; text-align:left; padding:8px 10px; font-weight:600;">Первый вход</th>
            <th style="background:#7c3aed; color:#fff; text-align:left; padding:8px 10px; font-weight:600;">Последний выход</th>
            <th style="background:#7c3aed; color:#fff; text-align:left; padding:8px 10px; font-weight:600;">Всего в комнате</th>
          </tr>
        </thead>
        <tbody>
          ${participantRows || `<tr><td colspan="6" style="text-align:center; color:#888; padding:14px;">Нет данных</td></tr>`}
        </tbody>
      </table>

      <div style="margin-top:24px; font-size:11px; color:#888; text-align:right;">VOCO · ${escapeHtml(room.slug)}</div>
    </div>
  `;
}

export async function downloadRoomReportPdf(report: RoomReport): Promise<void> {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.background = "#fff";
  container.innerHTML = buildReportNodeHtml(report);
  document.body.appendChild(container);

  try {
    const node = container.firstElementChild as HTMLElement;
    const canvas = await html2canvas(node, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
    });

    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 24;
    const renderWidth = pageWidth - margin * 2;
    const renderHeight = (canvas.height * renderWidth) / canvas.width;

    const imgData = canvas.toDataURL("image/png");

    if (renderHeight <= pageHeight - margin * 2) {
      pdf.addImage(imgData, "PNG", margin, margin, renderWidth, renderHeight);
    } else {
      // Разбиваем длинное изображение на страницы
      const pxPerPt = canvas.width / renderWidth;
      const pageContentHeightPx = (pageHeight - margin * 2) * pxPerPt;
      let yPx = 0;
      while (yPx < canvas.height) {
        const sliceHeightPx = Math.min(pageContentHeightPx, canvas.height - yPx);
        const sliceCanvas = document.createElement("canvas");
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = sliceHeightPx;
        const ctx = sliceCanvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(
            canvas,
            0,
            yPx,
            canvas.width,
            sliceHeightPx,
            0,
            0,
            canvas.width,
            sliceHeightPx
          );
          const sliceData = sliceCanvas.toDataURL("image/png");
          const sliceHeightPt = sliceHeightPx / pxPerPt;
          pdf.addImage(sliceData, "PNG", margin, margin, renderWidth, sliceHeightPt);
        }
        yPx += sliceHeightPx;
        if (yPx < canvas.height) pdf.addPage();
      }
    }

    const safeSlug = report.room.slug.replace(/[^a-zA-Z0-9_-]/g, "");
    pdf.save(`voco-report-${safeSlug}.pdf`);
  } finally {
    container.remove();
  }
}
