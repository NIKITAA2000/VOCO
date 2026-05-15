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
  const accent = "#0077FF";
  const softBlue = "#DEEEFF";
  const border = "#BBD8FF";

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
        <td style="padding:12px 14px; border-bottom:1px solid ${softBlue}; font-weight:600;">${escapeHtml(p.username)}</td>
        <td style="padding:12px 14px; border-bottom:1px solid ${softBlue};">${roleLabel}</td>
        <td style="padding:12px 14px; border-bottom:1px solid ${softBlue}; text-align:center;">${p.sessions.length}</td>
        <td style="padding:12px 14px; border-bottom:1px solid ${softBlue};">${formatDateTime(firstJoin)}</td>
        <td style="padding:12px 14px; border-bottom:1px solid ${softBlue};">${formatDateTime(lastLeave)}</td>
        <td style="padding:12px 14px; border-bottom:1px solid ${softBlue}; font-weight:600;">${formatDuration(p.totalMs)}</td>
      </tr>`;
    })
    .join("");

  return `
    <div style="font-family: Jost, 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color:#000; padding:30px; width:794px; background:#FFFFFF; box-sizing:border-box;">
      <div style="border:5px solid ${accent}; border-radius:25px; min-height:1090px; padding:24px; background:#FFFFFF; box-sizing:border-box;">
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:20px; margin-bottom:24px;">
          <div>
            <svg width="390" height="115" viewBox="0 0 475 140" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block; margin:0 0 10px;">
              <path d="M475 90C475 117.614 452.614 140 425 140C397.386 140 375 117.614 375 90C375 62.3858 397.386 40 425 40C452.614 40 475 62.3858 475 90ZM400 90C400 103.807 411.193 115 425 115C438.807 115 450 103.807 450 90C450 76.1929 438.807 65 425 65C411.193 65 400 76.1929 400 90Z" fill="black"/>
              <rect x="425" y="65" width="25" height="50" fill="black"/>
              <path d="M345.355 125.355C338.363 132.348 329.454 137.11 319.755 139.039C310.055 140.969 300.002 139.978 290.866 136.194C281.73 132.41 273.921 126.001 268.427 117.779C262.932 109.556 260 99.8891 260 90C260 80.1109 262.932 70.4439 268.427 62.2215C273.921 53.999 281.73 47.5904 290.866 43.806C300.002 40.0216 310.055 39.0315 319.755 40.9607C329.454 42.89 338.363 47.652 345.355 54.6447L327.678 72.3223C324.181 68.826 319.727 66.445 314.877 65.4804C310.028 64.5157 305.001 65.0108 300.433 66.903C295.865 68.7952 291.96 71.9995 289.213 76.1107C286.466 80.222 285 85.0555 285 90C285 94.9445 286.466 99.778 289.213 103.889C291.96 108 295.865 111.205 300.433 113.097C305.001 114.989 310.028 115.484 314.877 114.52C319.727 113.555 324.181 111.174 327.678 107.678L345.355 125.355Z" fill="black"/>
              <path d="M245 90C245 117.614 222.614 140 195 140C167.386 140 145 117.614 145 90C145 62.3858 167.386 40 195 40C222.614 40 245 62.3858 245 90ZM170 90C170 103.807 181.193 115 195 115C208.807 115 220 103.807 220 90C220 76.1929 208.807 65 195 65C181.193 65 170 76.1929 170 90Z" fill="black"/>
              <rect x="195" y="65" width="25" height="50" fill="black"/>
              <path d="M30 40L80 140L130 40H105L80 90L55 40H30Z" fill="black"/>
              <rect x="30" y="40" width="20" height="25" fill="black"/>
              <rect x="40" y="65" width="20" height="25" fill="black"/>
              <rect x="50" y="90" width="20" height="25" fill="black"/>
              <rect x="60" y="115" width="20" height="25" fill="black"/>
              <rect x="10" y="40" width="10" height="25" fill="${accent}"/>
              <rect x="20" y="65" width="10" height="25" fill="${accent}"/>
              <rect x="40" y="115" width="10" height="25" fill="${accent}"/>
              <rect x="30" y="90" width="10" height="25" fill="${accent}"/>
              <rect y="40" width="10" height="25" fill="#00FF00"/>
              <rect x="10" y="65" width="10" height="25" fill="#00FF00"/>
              <rect x="20" y="90" width="10" height="25" fill="#00FF00"/>
              <rect x="30" y="115" width="10" height="25" fill="#00FF00"/>
              <rect x="30" y="65" width="10" height="25" fill="#8000FF"/>
              <rect x="50" y="115" width="10" height="25" fill="#8000FF"/>
              <rect x="40" y="90" width="10" height="25" fill="#8000FF"/>
              <rect x="20" y="40" width="10" height="25" fill="#8000FF"/>
              <rect x="375" width="100" height="25" fill="black"/>
              <rect x="385" width="10" height="25" fill="${accent}"/>
              <rect x="375" width="10" height="25" fill="#00FF00"/>
              <rect x="395" width="10" height="25" fill="#8000FF"/>
              <rect x="145" width="100" height="25" fill="black"/>
              <rect x="145" width="10" height="25" fill="#00FF00"/>
              <rect x="155" width="10" height="25" fill="${accent}"/>
              <rect x="165" width="10" height="25" fill="#8000FF"/>
            </svg>
            <h1 style="font-size:28px; line-height:40px; margin:0; color:#000; font-style:italic; font-weight:400;">Отчёт о конференции</h1>
          </div>
          <div style="font-size:12px; line-height:18px; color:#555; text-align:right; padding-top:7px;">Сформировано<br><strong style="color:#000; font-weight:600;">${formatDateTime(new Date().toISOString())}</strong></div>
        </div>

        <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:12px; margin:0 0 22px;">
          <div style="border:1px solid ${border}; border-radius:100px; min-height:64px; padding:10px 14px; background:#FFFFFF; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; box-sizing:border-box;">
            <div style="font-size:11px; line-height:16px; color:#555;">Длительность</div>
            <div style="font-size:16px; line-height:23px; font-weight:600;">${formatDuration(room.durationMs)}</div>
          </div>
          <div style="border:1px solid ${border}; border-radius:100px; min-height:64px; padding:10px 14px; background:#FFFFFF; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; box-sizing:border-box;">
            <div style="font-size:11px; line-height:16px; color:#555;">Участников</div>
            <div style="font-size:16px; line-height:23px; font-weight:600;">${participants.length}</div>
          </div>
          <div style="border:1px solid ${border}; border-radius:100px; min-height:64px; padding:10px 14px; background:#FFFFFF; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; box-sizing:border-box;">
            <div style="font-size:11px; line-height:16px; color:#555;">Пик онлайн</div>
            <div style="font-size:16px; line-height:23px; font-weight:600;">${peakConcurrent}</div>
          </div>
          <div style="border:1px solid ${border}; border-radius:100px; min-height:64px; padding:10px 14px; background:#FFFFFF; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; box-sizing:border-box;">
            <div style="font-size:11px; line-height:16px; color:#555;">Код комнаты</div>
            <div style="font-size:16px; line-height:23px; font-weight:600;">${escapeHtml(room.slug)}</div>
          </div>
        </div>

        <dl style="display:grid; grid-template-columns:180px 1fr; gap:8px 16px; font-size:13px; line-height:19px; border:1px solid ${border}; border-radius:18px; padding:18px 20px; margin:0 0 24px; background:#fff; box-sizing:border-box;">
          <dt style="color:#555; font-weight:400; margin:0;">Название</dt><dd style="margin:0; font-weight:600; text-align:right; justify-self:end; max-width:100%;">${escapeHtml(room.name || "—")}</dd>
          <dt style="color:#555; font-weight:400; margin:0;">Владелец</dt><dd style="margin:0; font-weight:600; text-align:right; justify-self:end; max-width:100%;">${escapeHtml(room.owner.username)}</dd>
          <dt style="color:#555; font-weight:400; margin:0;">Начало</dt><dd style="margin:0; font-weight:600; text-align:right; justify-self:end; max-width:100%;">${formatDateTime(room.createdAt)}</dd>
          <dt style="color:#555; font-weight:400; margin:0;">Завершение</dt><dd style="margin:0; font-weight:600; text-align:right; justify-self:end; max-width:100%;">${formatDateTime(room.closedAt)}</dd>
        </dl>

        <h2 style="font-size:24px; line-height:35px; margin:0 0 10px; font-style:italic; font-weight:400;">Участники</h2>
        <table style="width:100%; border-collapse:separate; border-spacing:0; font-size:12px; line-height:18px; background:#fff; border:1px solid ${border}; border-radius:18px; overflow:hidden;">
        <thead>
          <tr>
            <th style="background:${accent}; color:#fff; text-align:left; padding:11px 14px; font-weight:600;">Ник</th>
            <th style="background:${accent}; color:#fff; text-align:left; padding:11px 14px; font-weight:600;">Роль</th>
            <th style="background:${accent}; color:#fff; text-align:center; padding:11px 14px; font-weight:600;">Сессий</th>
            <th style="background:${accent}; color:#fff; text-align:left; padding:11px 14px; font-weight:600;">Первый вход</th>
            <th style="background:${accent}; color:#fff; text-align:left; padding:11px 14px; font-weight:600;">Последний выход</th>
            <th style="background:${accent}; color:#fff; text-align:left; padding:11px 14px; font-weight:600;">Всего</th>
          </tr>
        </thead>
        <tbody>
          ${participantRows || `<tr><td colspan="6" style="text-align:center; color:#888; padding:18px;">Нет данных</td></tr>`}
        </tbody>
      </table>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:22px; font-size:11px; line-height:16px; color:#666;">
          <span>VOCO · Информация о комнате</span>
          <span>${escapeHtml(room.slug)}</span>
        </div>
      </div>
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
