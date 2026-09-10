import React from "react";
import { AbsoluteFill } from "remotion";
import { Scene, Glyph, Shot, Chip, Icon, ACCENT, DIM } from "./shared";

/** Wide banner (1920×960) — copy left, the chat widget right. */
export const ThumbWide: React.FC = () => (
	<Scene glow={{ x: "24%", y: "34%", size: 1000, opacity: 0.18 }}>
		<AbsoluteFill style={{ flexDirection: "row", alignItems: "center" }}>
			<div style={{ width: 830, flex: "none", paddingLeft: 96 }}>
				<div style={{ display: "flex", alignItems: "center", gap: 28 }}>
					<Glyph size={118} />
					<div style={{ fontSize: 98, fontWeight: 800, color: "#fff", lineHeight: 1 }}>
						Twitch<span style={{ color: ACCENT }}>ify</span>
					</div>
				</div>
				<div style={{ fontSize: 39, color: DIM, marginTop: 30, lineHeight: 1.35, fontWeight: 500 }}>
					Twitch on your <span style={{ color: "#fff", fontWeight: 700 }}>XENEON EDGE</span> —
					<br />
					for streamers, mods, and anyone watching.
				</div>
				<div style={{ width: 190, height: 8, borderRadius: 6, background: ACCENT, margin: "30px 0" }} />
				<div style={{ display: "flex", flexWrap: "wrap", gap: 14, maxWidth: 740 }}>
					<Chip><Icon name="eye" size={27} /> Watch any chat</Chip>
					<Chip><Icon name="ban" size={27} /> One-tap moderation</Chip>
					<Chip><Icon name="split" size={27} /> Multi-chat</Chip>
					<Chip><Icon name="live" size={27} /> Activity feed</Chip>
					<Chip><Icon name="stats" size={27} /> Stats</Chip>
					<Chip><Icon name="panel" size={27} /> Custom panels</Chip>
					<Chip><Icon name="browser" size={27} /> Watch Sync add-on</Chip>
				</div>
			</div>

			<div style={{ flex: 1, display: "flex", justifyContent: "center", paddingRight: 40 }}>
				<Shot src="chat.png" width={950} />
			</div>
		</AbsoluteFill>
	</Scene>
);
