import React from "react";
import { AbsoluteFill } from "remotion";
import { Scene, Glyph, Shot, ACCENT, DIM } from "./shared";

/** Thumbnail 1 — hero: logo mark, name, tagline, the full widget below. */
export const ThumbHero: React.FC = () => (
	<Scene glow={{ x: "50%", y: "16%", size: 1300, opacity: 0.24 }}>
		<AbsoluteFill style={{ alignItems: "center" }}>
			<Glyph size={160} style={{ marginTop: 52 }} />
			<div style={{ fontSize: 116, fontWeight: 800, color: "#fff", marginTop: 6, lineHeight: 1 }}>
				Twitch<span style={{ color: ACCENT }}>ify</span>
			</div>
			<div style={{ fontSize: 40, color: DIM, marginTop: 18, fontWeight: 500 }}>
				Twitch mission control on your <span style={{ color: "#fff", fontWeight: 700 }}>XENEON EDGE</span>
			</div>
			<Shot src="full.png" width={1720} style={{ marginTop: 46 }} />
		</AbsoluteFill>
	</Scene>
);
