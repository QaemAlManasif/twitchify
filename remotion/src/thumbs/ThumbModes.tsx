import React from "react";
import { AbsoluteFill } from "remotion";
import { Scene, Wordmark, Shot, Icon, IconName, ACCENT, ACCENT_SOFT, DIM } from "./shared";

const Mode: React.FC<{ icon: IconName; label: string; src: string; width: number }> = ({ icon, label, src, width }) => (
	<div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start", flex: "none" }}>
		<div style={{ display: "flex", alignItems: "center", gap: 12, color: "#fff", fontSize: 28, fontWeight: 700 }}>
			<Icon name={icon} size={28} />
			{label}
		</div>
		<Shot src={src} width={width} />
	</div>
);

const Point: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<div style={{ display: "flex", alignItems: "flex-start", gap: 14, fontSize: 26, color: DIM, lineHeight: 1.35 }}>
		<div style={{ width: 10, height: 10, borderRadius: 5, background: ACCENT, marginTop: 12, flex: "none" }} />
		<div>{children}</div>
	</div>
);

/** Thumbnail 2 — one widget, many jobs: chat plus the three single-purpose copies, in two rows. */
export const ThumbModes: React.FC = () => (
	<Scene glow={{ x: "50%", y: "40%", size: 1400, opacity: 0.18 }}>
		<Wordmark size={58} style={{ position: "absolute", top: 46, left: 84 }} />
		<div style={{ position: "absolute", top: 62, right: 90, fontSize: 26, color: DIM, fontWeight: 600 }}>
			iCUE widget for XENEON EDGE
		</div>

		<AbsoluteFill style={{ padding: "122px 84px 0", alignItems: "flex-start" }}>
			<div style={{ fontSize: 68, fontWeight: 800, color: "#fff", lineHeight: 1.05 }}>
				One widget. <span style={{ color: ACCENT_SOFT }}>Any job.</span>
			</div>
			<div style={{ fontSize: 27, color: DIM, marginTop: 8, fontWeight: 500 }}>
				Add it more than once and give each copy a role from iCUE's own widget settings.
			</div>
			<div style={{ width: 200, height: 8, borderRadius: 6, background: ACCENT, margin: "18px 0 20px" }} />

			<div style={{ display: "flex", gap: 28, alignItems: "flex-start" }}>
				<Mode icon="chat" label="Chat & controls" src="chat.png" width={660} />
				<Mode icon="live" label="Activity feed" src="feed.png" width={412} />
				<Mode icon="grid" label="Quick actions" src="actions.png" width={412} />
			</div>
			<div style={{ display: "flex", gap: 28, alignItems: "flex-start", marginTop: 22 }}>
				<Mode icon="stats" label="Stats" src="stats.png" width={412} />
				<div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 46, maxWidth: 1240 }}>
					<Point>Every copy shares the sign-in — connect once, they all come up signed in.</Point>
					<Point>Switch channel in one and the others follow. Each copy keeps its own text size.</Point>
					<Point>Paste a browser-source link and a copy becomes that panel: alert boxes, goal bars, overlays.</Point>
					<Point>Just watching? Pick any channel you follow, or pin one, and read its chat beside your game.</Point>
				</div>
			</div>
		</AbsoluteFill>
	</Scene>
);
