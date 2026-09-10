import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";

export const FONT = `"Segoe UI", "Inter", -apple-system, sans-serif`;
export const ACCENT = "#9146ff";
export const ACCENT_SOFT = "#c6a8ff";
export const BG = "#0a0a0c";
export const DIM = "#9b9ba4";

/**
 * Dark stage: flat near-black base, ONE soft purple glow (position tunable),
 * and a gentle bottom vignette. No competing colours.
 */
export const Scene: React.FC<{
	children: React.ReactNode;
	glow?: { x: string; y: string; size?: number; opacity?: number };
}> = ({ children, glow = { x: "50%", y: "30%" } }) => (
	<AbsoluteFill style={{ background: BG, fontFamily: FONT, overflow: "hidden" }}>
		<AbsoluteFill
			style={{
				background: `radial-gradient(${glow.size ?? 1100}px ${(glow.size ?? 1100) * 0.72}px at ${glow.x} ${glow.y}, rgba(145,70,255,${glow.opacity ?? 0.22}), transparent 70%)`,
			}}
		/>
		<AbsoluteFill style={{ background: "linear-gradient(180deg, transparent 55%, rgba(0,0,0,0.45))" }} />
		{children}
	</AbsoluteFill>
);

/** The logo mark, purple on transparent, with a soft glow. */
export const Glyph: React.FC<{ size: number; style?: React.CSSProperties }> = ({ size, style }) => (
	<Img
		src={staticFile("logo.svg")}
		style={{ width: size, height: size, filter: "drop-shadow(0 0 40px rgba(145,70,255,0.55))", ...style }}
	/>
);

export const Wordmark: React.FC<{ size?: number; style?: React.CSSProperties }> = ({ size = 56, style }) => (
	<div style={{ display: "flex", alignItems: "center", gap: size * 0.24, ...style }}>
		<Glyph size={size} />
		<div style={{ fontSize: size * 0.62, fontWeight: 800, color: "#fff", letterSpacing: "-0.01em" }}>
			Twitch<span style={{ color: ACCENT }}>ify</span>
		</div>
	</div>
);

/** Framed screenshot card — straight, fully visible, quiet shadow. */
export const Shot: React.FC<{ src: string; width: number; style?: React.CSSProperties }> = ({ src, width, style }) => (
	<div
		style={{
			width,
			borderRadius: 22,
			overflow: "hidden",
			border: "1.5px solid rgba(255,255,255,0.10)",
			boxShadow: "0 30px 70px rgba(0,0,0,0.55)",
			background: BG,
			flex: "none",
			...style,
		}}
	>
		<Img src={staticFile(src)} style={{ width: "100%", display: "block" }} />
	</div>
);

export const Chip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<div
		style={{
			display: "inline-flex",
			alignItems: "center",
			gap: 12,
			padding: "13px 24px",
			borderRadius: 14,
			background: "rgba(255,255,255,0.055)",
			border: "1px solid rgba(255,255,255,0.11)",
			color: "#ede6ff",
			fontSize: 27,
			fontWeight: 600,
			whiteSpace: "nowrap",
		}}
	>
		{children}
	</div>
);

/* The widget's own icon family: 24px grid, stroke only, round caps. */
const iconPaths: Record<string, React.ReactNode> = {
	chat: <path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a9 9 0 0 1 18 0z" />,
	ban: (
		<>
			<circle cx="12" cy="12" r="9" />
			<path d="m5.6 5.6 12.8 12.8" />
		</>
	),
	split: (
		<>
			<rect x="3" y="4" width="7.5" height="16" rx="2" />
			<rect x="13.5" y="4" width="7.5" height="16" rx="2" />
		</>
	),
	heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />,
	live: <path d="M2 12h4l3-8 4 16 3-8h6" />,
	stats: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
	grid: (
		<>
			<rect x="3" y="3" width="7" height="7" rx="1.5" />
			<rect x="14" y="3" width="7" height="7" rx="1.5" />
			<rect x="3" y="14" width="7" height="7" rx="1.5" />
			<rect x="14" y="14" width="7" height="7" rx="1.5" />
		</>
	),
	bolt: <path d="M13 2 3 14h8l-1 8 10-12h-8z" />,
	shield: <path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z" />,
	clip: (
		<>
			<circle cx="6" cy="6" r="3" />
			<circle cx="6" cy="18" r="3" />
			<path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" />
		</>
	),
	raid: (
		<>
			<circle cx="8" cy="8" r="3.5" />
			<path d="M2 20v-1.5A4.5 4.5 0 0 1 6.5 14h3a4.5 4.5 0 0 1 4.5 4.5V20" />
			<path d="M16 4h5v5" />
			<path d="m21 4-7 7" />
		</>
	),
	panel: (
		<>
			<rect x="3" y="4" width="18" height="16" rx="2" />
			<path d="M3 9h18M9 9v11" />
		</>
	),
	cast: (
		<>
			<circle cx="12" cy="12" r="2" />
			<path d="M4.9 19.1a10 10 0 0 1 0-14.2" />
			<path d="M7.8 16.2a6 6 0 0 1 0-8.4" />
			<path d="M16.2 7.8a6 6 0 0 1 0 8.4" />
			<path d="M19.1 4.9a10 10 0 0 1 0 14.2" />
		</>
	),
	star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.2 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.2 6.1-.9z" />,
	eye: (
		<>
			<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
			<circle cx="12" cy="12" r="3" />
		</>
	),
	pin: (
		<>
			<path d="M12 17v5" />
			<path d="M9 10.8V4h6v6.8l2.5 3.2a1 1 0 0 1-.8 1.6H7.3a1 1 0 0 1-.8-1.6z" />
		</>
	),
	browser: (
		<>
			<rect x="2" y="4" width="20" height="16" rx="2" />
			<path d="M2 9h20M6 6.5h.01M9 6.5h.01" />
		</>
	),
	hand: (
		<>
			<path d="M18 11V6a2 2 0 0 0-4 0v5" />
			<path d="M14 10V4a2 2 0 0 0-4 0v6" />
			<path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
			<path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.4L2.4 15.6a2 2 0 0 1 2.9-2.8L6 14" />
		</>
	),
};

export type IconName = keyof typeof iconPaths;

export const Icon: React.FC<{ name: IconName; size?: number; color?: string }> = ({
	name,
	size = 28,
	color = ACCENT_SOFT,
}) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		stroke={color}
		strokeWidth={2}
		strokeLinecap="round"
		strokeLinejoin="round"
		fill="none"
		style={{ flex: "none" }}
	>
		{iconPaths[name]}
	</svg>
);

export const IconTile: React.FC<{ name: IconName; size?: number }> = ({ name, size = 64 }) => (
	<div
		style={{
			width: size,
			height: size,
			borderRadius: size * 0.28,
			background: "rgba(145,70,255,0.16)",
			border: "1px solid rgba(180,130,255,0.32)",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			flex: "none",
		}}
	>
		<Icon name={name} size={size * 0.52} />
	</div>
);

export const Feature: React.FC<{ icon: IconName; title: string; sub: string }> = ({ icon, title, sub }) => (
	<div style={{ display: "flex", alignItems: "center", gap: 26 }}>
		<IconTile name={icon} size={76} />
		<div>
			<div style={{ fontSize: 37, fontWeight: 750, color: "#fff" }}>{title}</div>
			<div style={{ fontSize: 26, color: DIM, marginTop: 4 }}>{sub}</div>
		</div>
	</div>
);
