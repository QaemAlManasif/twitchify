import React from "react";
import { AbsoluteFill } from "remotion";
import { Scene, Wordmark, Shot, Feature, ACCENT, ACCENT_SOFT, DIM } from "./shared";

/** Thumbnail 3 — moderation and the dashboard: features left, the everything layout right. */
export const ThumbDashboard: React.FC = () => (
	<Scene glow={{ x: "74%", y: "50%", size: 1000, opacity: 0.18 }}>
		<Wordmark size={62} style={{ position: "absolute", top: 54, left: 84 }} />
		<div style={{ position: "absolute", top: 72, right: 90, fontSize: 27, color: DIM, fontWeight: 600 }}>
			iCUE widget for XENEON EDGE
		</div>

		<AbsoluteFill style={{ flexDirection: "row", alignItems: "center", padding: "60px 90px 0 84px" }}>
			<div style={{ width: 860, flex: "none" }}>
				<div style={{ fontSize: 92, fontWeight: 800, color: "#fff", lineHeight: 1.08, whiteSpace: "nowrap" }}>
					Moderate
					<br />
					<span style={{ color: ACCENT_SOFT }}>with one tap.</span>
				</div>
				<div style={{ width: 210, height: 9, borderRadius: 6, background: ACCENT, margin: "30px 0 44px" }} />
				<div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
					<Feature icon="ban" title="Timeout, ban, delete, warn" sub="Tap any message — every channel you mod" />
					<Feature icon="split" title="Four chats side by side" sub="Drag channels in, save the layout" />
					<Feature icon="heart" title="Follows, subs, bits, raids" sub="A live activity feed beside the chat" />
					<Feature icon="bolt" title="Clip, marker, ad, raid" sub="Your own stream's controls, as tiles" />
				</div>
			</div>

			<div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
				<Shot src="strip.png" width={880} />
			</div>
		</AbsoluteFill>
	</Scene>
);
