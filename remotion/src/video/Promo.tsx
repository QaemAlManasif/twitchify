import React from "react";
import {
	AbsoluteFill,
	Img,
	Sequence,
	interpolate,
	spring,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
} from "remotion";
import { Scene, Glyph, Icon, IconName, ACCENT, ACCENT_SOFT, BG, DIM, FONT } from "../thumbs/shared";

export const PROMO_FPS = 30;

/* Scene lengths, in seconds. */
const S = {
	intro: 3.6,
	full: 4.6,
	watch: 5.6,
	modes: 6.4,
	mod: 5.4,
	panels: 4.4,
	outro: 3.6,
};
const secs = (n: number) => Math.round(n * PROMO_FPS);
export const PROMO_FRAMES = secs(S.intro + S.full + S.watch + S.modes + S.mod + S.panels + S.outro);

const ease = { damping: 200, stiffness: 120, mass: 0.9 };

/** 0→1 spring from `at` frames into the sequence. */
const useIn = (at = 0, config = ease) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	return spring({ frame: frame - at, fps, config, durationInFrames: 30 });
};

/** Fade the whole sequence out over its last `len` frames. */
const useOut = (len = 12) => {
	const frame = useCurrentFrame();
	const { durationInFrames } = useVideoConfig();
	return interpolate(frame, [durationInFrames - len, durationInFrames], [1, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
};

const Rise: React.FC<{ at?: number; children: React.ReactNode; style?: React.CSSProperties; dist?: number }> = ({
	at = 0,
	children,
	style,
	dist = 40,
}) => {
	const v = useIn(at);
	return (
		<div style={{ opacity: v, transform: `translateY(${(1 - v) * dist}px)`, ...style }}>{children}</div>
	);
};

const Frame: React.FC<{ src: string; width: number; at?: number; style?: React.CSSProperties }> = ({
	src,
	width,
	at = 0,
	style,
}) => {
	const v = useIn(at, { damping: 30, stiffness: 90, mass: 1 });
	return (
		<div
			style={{
				width,
				borderRadius: 22,
				overflow: "hidden",
				border: "1.5px solid rgba(255,255,255,0.10)",
				boxShadow: "0 30px 70px rgba(0,0,0,0.55)",
				background: BG,
				flex: "none",
				opacity: v,
				transform: `translateY(${(1 - v) * 60}px) scale(${0.96 + v * 0.04})`,
				...style,
			}}
		>
			<Img src={staticFile(src)} style={{ width: "100%", display: "block" }} />
		</div>
	);
};

const Title: React.FC<{ children: React.ReactNode; size?: number; at?: number; style?: React.CSSProperties }> = ({
	children,
	size = 84,
	at = 0,
	style,
}) => (
	<Rise at={at} style={style}>
		<div style={{ fontSize: size, fontWeight: 800, color: "#fff", lineHeight: 1.06, letterSpacing: "-0.01em" }}>
			{children}
		</div>
	</Rise>
);

const Sub: React.FC<{ children: React.ReactNode; at?: number; style?: React.CSSProperties }> = ({ children, at = 6, style }) => (
	<Rise at={at} style={style}>
		<div style={{ fontSize: 32, color: DIM, fontWeight: 500, lineHeight: 1.35 }}>{children}</div>
	</Rise>
);

/* ── 1. Intro: mark, name, tagline ─────────────────────────────── */
const Intro: React.FC = () => {
	const out = useOut();
	const mark = useIn(0, { damping: 18, stiffness: 140, mass: 0.8 });
	return (
		<AbsoluteFill style={{ opacity: out, alignItems: "center", justifyContent: "center" }}>
			<div style={{ transform: `scale(${mark})`, opacity: mark }}>
				<Glyph size={230} />
			</div>
			<Rise at={10} style={{ marginTop: 18 }}>
				<div style={{ fontSize: 150, fontWeight: 800, color: "#fff", lineHeight: 1, letterSpacing: "-0.02em" }}>
					Twitch<span style={{ color: ACCENT }}>ify</span>
				</div>
			</Rise>
			<Sub at={22}>
				Twitch mission control on your <span style={{ color: "#fff", fontWeight: 700 }}>XENEON EDGE</span>
			</Sub>
		</AbsoluteFill>
	);
};

/* ── 2. The whole thing ─────────────────────────────────────────── */
const Full: React.FC = () => {
	const out = useOut();
	return (
		<AbsoluteFill style={{ opacity: out, alignItems: "center", paddingTop: 96 }}>
			<Title>
				Chat, moderation, activity, stats. <span style={{ color: ACCENT_SOFT }}>One screen.</span>
			</Title>
			<Sub>Live chat with one-tap moderation across every channel you moderate.</Sub>
			<Frame src="full.png" width={1760} at={8} style={{ marginTop: 52 }} />
		</AbsoluteFill>
	);
};

/* ── 3. One widget, many jobs ───────────────────────────────────── */
const ModeCard: React.FC<{ icon: IconName; label: string; src: string; width: number; at: number }> = ({
	icon,
	label,
	src,
	width,
	at,
}) => (
	<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
		<Rise at={at + 4}>
			<div style={{ display: "flex", alignItems: "center", gap: 12, color: "#fff", fontSize: 30, fontWeight: 700 }}>
				<Icon name={icon} size={30} />
				{label}
			</div>
		</Rise>
		<Frame src={src} width={width} at={at} />
	</div>
);

const Modes: React.FC = () => {
	const out = useOut();
	return (
		<AbsoluteFill style={{ opacity: out, padding: "110px 84px 0" }}>
			<Title>
				One widget. <span style={{ color: ACCENT_SOFT }}>Any job.</span>
			</Title>
			<Sub>Add Twitchify more than once and give each copy a role from iCUE's own settings.</Sub>
			<div style={{ display: "flex", gap: 30, alignItems: "flex-start", marginTop: 44 }}>
				<ModeCard icon="chat" label="Chat & controls" src="chat.png" width={720} at={14} />
				<ModeCard icon="live" label="Activity feed" src="feed.png" width={330} at={26} />
				<ModeCard icon="grid" label="Quick actions" src="actions.png" width={330} at={36} />
				<ModeCard icon="stats" label="Stats" src="stats.png" width={330} at={46} />
			</div>
		</AbsoluteFill>
	);
};

/* ── 4. Moderation and the dashboard ────────────────────────────── */
const Line: React.FC<{ icon: IconName; title: string; sub: string; at: number }> = ({ icon, title, sub, at }) => (
	<Rise at={at} dist={24}>
		<div style={{ display: "flex", alignItems: "center", gap: 26 }}>
			<div
				style={{
					width: 76,
					height: 76,
					borderRadius: 22,
					background: "rgba(145,70,255,0.16)",
					border: "1px solid rgba(180,130,255,0.32)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					flex: "none",
				}}
			>
				<Icon name={icon} size={40} />
			</div>
			<div>
				<div style={{ fontSize: 37, fontWeight: 750, color: "#fff" }}>{title}</div>
				<div style={{ fontSize: 26, color: DIM, marginTop: 4 }}>{sub}</div>
			</div>
		</div>
	</Rise>
);

const Mod: React.FC = () => {
	const out = useOut();
	return (
		<AbsoluteFill style={{ opacity: out, flexDirection: "row", alignItems: "center", padding: "0 90px 0 84px" }}>
			<div style={{ width: 860, flex: "none" }}>
				<Title size={92}>
					Moderate
					<br />
					<span style={{ color: ACCENT_SOFT }}>with one tap.</span>
				</Title>
				<Rise at={8}>
					<div style={{ width: 210, height: 9, borderRadius: 6, background: ACCENT, margin: "30px 0 44px" }} />
				</Rise>
				<div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
					<Line icon="ban" title="Timeout, ban, delete, warn" sub="Tap any message, in every channel you mod" at={12} />
					<Line icon="split" title="Four chats side by side" sub="Drag channels in, save the layout" at={22} />
					<Line icon="heart" title="Follows, subs, bits, raids" sub="A live activity feed, beside or in the chat" at={32} />
					<Line icon="bolt" title="Clip, marker, ad, raid" sub="Your own stream's controls as tiles" at={42} />
				</div>
			</div>
			<div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
				<Frame src="strip.png" width={880} at={16} />
			</div>
		</AbsoluteFill>
	);
};

/* ── 3b. Just watching ──────────────────────────────────────────── */
const Watch: React.FC = () => {
	const out = useOut();
	return (
		<AbsoluteFill style={{ opacity: out, flexDirection: "row", alignItems: "center", padding: "0 90px 0 84px" }}>
			<div style={{ width: 900, flex: "none" }}>
				<Title size={92}>
					Just watching?
					<br />
					<span style={{ color: ACCENT_SOFT }}>It's a chat window too.</span>
				</Title>
				<Rise at={8}>
					<div style={{ width: 210, height: 9, borderRadius: 6, background: ACCENT, margin: "30px 0 44px" }} />
				</Rise>
				<div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
					<Line icon="eye" title="Any channel you follow" sub="The live ones are listed, with viewer counts" at={12} />
					<Line icon="pin" title="Pin any channel" sub="Read its chat beside your game — no mod powers needed" at={22} />
					<Line icon="browser" title="Watch Sync — optional" sub="Chat follows the Twitch tab you have open in your browser" at={32} />
					<Line icon="shield" title="Extension + a small helper" sub="Only channel names, only on your PC — nothing leaves it" at={42} />
				</div>
			</div>
			<div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
				<Frame src="chat.png" width={840} at={16} />
			</div>
		</AbsoluteFill>
	);
};

/* ── 5. Custom panels ───────────────────────────────────────────── */
const Panels: React.FC = () => {
	const out = useOut();
	return (
		<AbsoluteFill style={{ opacity: out, alignItems: "center", paddingTop: 120 }}>
			<Title>
				Your overlays, <span style={{ color: ACCENT_SOFT }}>framed.</span>
			</Title>
			<Sub>Paste any browser-source link — alert boxes, goal bars, overlays — and a copy becomes that panel.</Sub>
			<Rise at={14} style={{ marginTop: 56 }}>
				<div style={{ display: "flex", gap: 18 }}>
					{(["panel", "cast", "shield", "raid", "clip"] as IconName[]).map((n, i) => (
						<div
							key={n}
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 12,
								padding: "16px 28px",
								borderRadius: 16,
								background: "rgba(255,255,255,0.055)",
								border: "1px solid rgba(255,255,255,0.11)",
								color: "#ede6ff",
								fontSize: 30,
								fontWeight: 600,
							}}
						>
							<Icon name={n} size={30} />
							{["Custom panels", "Stream info", "Shield Mode", "Raid", "Clip that"][i]}
						</div>
					))}
				</div>
			</Rise>
			<Frame src="actions.png" width={900} at={24} style={{ marginTop: 56 }} />
		</AbsoluteFill>
	);
};

/* ── 6. Outro ───────────────────────────────────────────────────── */
const Outro: React.FC = () => {
	const mark = useIn(0, { damping: 18, stiffness: 140, mass: 0.8 });
	return (
		<AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
			<div style={{ display: "flex", alignItems: "center", gap: 34, transform: `scale(${mark})`, opacity: mark }}>
				<Glyph size={150} />
				<div style={{ fontSize: 132, fontWeight: 800, color: "#fff", lineHeight: 1, letterSpacing: "-0.02em" }}>
					Twitch<span style={{ color: ACCENT }}>ify</span>
				</div>
			</div>
			<Sub at={14} style={{ marginTop: 26 }}>
				iCUE widget · CORSAIR <span style={{ color: "#fff", fontWeight: 700 }}>XENEON EDGE</span>
			</Sub>
			<Rise at={24} style={{ marginTop: 40 }}>
				<div style={{ fontSize: 26, color: DIM, fontWeight: 600, letterSpacing: "0.04em" }}>
					Connect once on twitch.tv — no keys, no setup
				</div>
			</Rise>
		</AbsoluteFill>
	);
};

/** Glow that drifts slowly across the whole video. */
const Stage: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const frame = useCurrentFrame();
	const x = 50 + Math.sin(frame / 140) * 22;
	const y = 34 + Math.cos(frame / 190) * 14;
	return (
		<Scene glow={{ x: `${x}%`, y: `${y}%`, size: 1400, opacity: 0.2 }}>
			<AbsoluteFill style={{ fontFamily: FONT }}>{children}</AbsoluteFill>
		</Scene>
	);
};

export const Promo: React.FC = () => {
	let at = 0;
	const seq = (len: number) => {
		const from = at;
		at += secs(len);
		return { from, durationInFrames: secs(len) };
	};
	return (
		<Stage>
			<Sequence {...seq(S.intro)} name="Intro"><Intro /></Sequence>
			<Sequence {...seq(S.full)} name="Everything"><Full /></Sequence>
			<Sequence {...seq(S.watch)} name="Watching"><Watch /></Sequence>
			<Sequence {...seq(S.modes)} name="Modes"><Modes /></Sequence>
			<Sequence {...seq(S.mod)} name="Moderation"><Mod /></Sequence>
			<Sequence {...seq(S.panels)} name="Panels"><Panels /></Sequence>
			<Sequence {...seq(S.outro)} name="Outro"><Outro /></Sequence>
		</Stage>
	);
};
