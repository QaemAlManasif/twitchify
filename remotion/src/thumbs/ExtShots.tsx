import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Scene, Glyph, Shot, Icon, IconName, ACCENT, ACCENT_SOFT, DIM } from "./shared";

/**
 * Chrome Web Store screenshots — 1280×800, the size the store shows at full
 * width. Three of them: what it does, how it works, what it shares.
 */

const Head: React.FC<{ title: React.ReactNode; sub: string }> = ({ title, sub }) => (
	<div style={{ textAlign: "center" }}>
		<div style={{ fontSize: 46, fontWeight: 800, color: "#fff", lineHeight: 1.1, letterSpacing: "-0.01em" }}>
			{title}
		</div>
		<div style={{ fontSize: 21, color: DIM, marginTop: 10, fontWeight: 500 }}>{sub}</div>
	</div>
);

const Badge: React.FC = () => (
	<div style={{ position: "absolute", top: 26, left: 34, display: "flex", alignItems: "center", gap: 11 }}>
		<Glyph size={30} />
		<div style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>
			Twitch<span style={{ color: ACCENT }}>ify</span>{" "}
			<span style={{ color: DIM, fontWeight: 600 }}>Watch Sync</span>
		</div>
	</div>
);

/* ── 1. Open a channel, its chat is on the EDGE ─────────────────── */
export const ExtShotFollow: React.FC = () => (
	<Scene glow={{ x: "50%", y: "26%", size: 900, opacity: 0.2 }}>
		<Badge />
		<AbsoluteFill style={{ alignItems: "center", paddingTop: 82 }}>
			<Head
				title={
					<>
						Watch a channel. <span style={{ color: ACCENT_SOFT }}>Its chat is right there.</span>
					</>
				}
				sub="Open Twitch in your browser and the channel appears on your XENEON EDGE."
			/>
			<Shot src="watching.png" width={1150} style={{ marginTop: 40 }} />
		</AbsoluteFill>
	</Scene>
);

/* ── 2. How it works ────────────────────────────────────────────── */
const Node: React.FC<{ icon: IconName; title: string; sub: string }> = ({ icon, title, sub }) => (
	<div
		style={{
			width: 300,
			padding: "26px 22px",
			borderRadius: 18,
			background: "rgba(255,255,255,0.045)",
			border: "1px solid rgba(255,255,255,0.10)",
			textAlign: "center",
			flex: "none",
		}}
	>
		<div
			style={{
				width: 62,
				height: 62,
				margin: "0 auto 14px",
				borderRadius: 18,
				background: "rgba(145,70,255,0.16)",
				border: "1px solid rgba(180,130,255,0.32)",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<Icon name={icon} size={30} />
		</div>
		<div style={{ fontSize: 23, fontWeight: 750, color: "#fff" }}>{title}</div>
		<div style={{ fontSize: 16, color: DIM, marginTop: 6, lineHeight: 1.4 }}>{sub}</div>
	</div>
);

const Arrow: React.FC<{ label: string }> = ({ label }) => (
	<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flex: "none", padding: "0 6px" }}>
		<svg width="74" height="16" viewBox="0 0 74 16" fill="none" style={{ overflow: "visible" }}>
			<path
				d="M2 8h64"
				stroke={ACCENT}
				strokeWidth="2.5"
				strokeLinecap="round"
				strokeDasharray="7 6"
			/>
			<path d="m62 3 6 5-6 5" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
		</svg>
		<div style={{ fontSize: 14, color: ACCENT_SOFT, fontWeight: 700, whiteSpace: "nowrap" }}>{label}</div>
	</div>
);

export const ExtShotHow: React.FC = () => (
	<Scene glow={{ x: "50%", y: "44%", size: 1000, opacity: 0.18 }}>
		<Badge />
		<AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingTop: 30 }}>
			<Head title="How it works" sub="Three pieces on your own computer. Nothing in between." />
			<div style={{ display: "flex", alignItems: "center", marginTop: 52 }}>
				<Node icon="browser" title="This extension" sub="Sees which Twitch tabs are open" />
				<Arrow label="channel name" />
				<Node icon="shield" title="Helper app" sub="Runs on your PC, with iCUE" />
				<Arrow label="127.0.0.1" />
				<Node icon="chat" title="Twitchify widget" sub="Shows that channel's chat" />
			</div>
			<div
				style={{
					marginTop: 46,
					padding: "15px 30px",
					borderRadius: 14,
					background: "rgba(16,185,129,0.10)",
					border: "1px solid rgba(16,185,129,0.28)",
					color: "#6ee7b7",
					fontSize: 19,
					fontWeight: 650,
				}}
			>
				Nothing leaves your computer — no accounts, no page content, no servers.
			</div>
		</AbsoluteFill>
	</Scene>
);

/* ── 3. What it shares ──────────────────────────────────────────── */
const Line: React.FC<{ ok?: boolean; children: React.ReactNode }> = ({ ok, children }) => (
	<div style={{ display: "flex", alignItems: "center", gap: 15, fontSize: 21, color: ok ? "#fff" : DIM }}>
		<svg width="26" height="26" viewBox="0 0 24 24" fill="none" style={{ flex: "none" }}>
			<circle cx="12" cy="12" r="10" fill={ok ? "rgba(16,185,129,0.16)" : "rgba(255,255,255,0.05)"} />
			{ok ? (
				<path d="m7.5 12.5 3 3 6-6.5" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
			) : (
				<path d="m8.5 8.5 7 7M15.5 8.5l-7 7" stroke="#6b6b74" strokeWidth="2.2" strokeLinecap="round" />
			)}
		</svg>
		{children}
	</div>
);

export const ExtShotPrivacy: React.FC = () => (
	<Scene glow={{ x: "70%", y: "40%", size: 900, opacity: 0.16 }}>
		<Badge />
		<AbsoluteFill style={{ flexDirection: "row", alignItems: "center", padding: "60px 70px 0" }}>
			<div style={{ flex: 1, minWidth: 0 }}>
				<div style={{ fontSize: 46, fontWeight: 800, color: "#fff", lineHeight: 1.1 }}>
					Only the <span style={{ color: ACCENT_SOFT }}>channel name.</span>
				</div>
				<div style={{ width: 150, height: 7, borderRadius: 6, background: ACCENT, margin: "24px 0 30px" }} />
				<div style={{ display: "flex", flexDirection: "column", gap: 17 }}>
					<Line ok>The name of the Twitch channel in your tab</Line>
					<Line ok>Which tab you are looking at, so chat can follow</Line>
					<Line>No page content, messages, or cookies</Line>
					<Line>No account details, and no servers</Line>
					<Line>Nothing collected, stored, or sold</Line>
				</div>
			</div>
			<div style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 18, width: 420 }}>
				<Img
					src={staticFile("popup.png")}
					style={{
						width: 300,
						display: "block",
						borderRadius: 16,
						border: "1px solid rgba(255,255,255,0.10)",
						boxShadow: "0 26px 60px rgba(0,0,0,0.55)",
					}}
				/>
				<div style={{ fontSize: 16, color: DIM, textAlign: "center", lineHeight: 1.45 }}>
					The popup shows whether the helper
					<br />
					and the widget are connected.
				</div>
			</div>
		</AbsoluteFill>
	</Scene>
);
