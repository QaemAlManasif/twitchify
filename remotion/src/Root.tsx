import { Composition, Still } from "remotion";
import { ThumbHero } from "./thumbs/ThumbHero";
import { ThumbModes } from "./thumbs/ThumbModes";
import { ThumbDashboard } from "./thumbs/ThumbDashboard";
import { ThumbWide } from "./thumbs/ThumbWide";
import { ExtShotFollow, ExtShotHow, ExtShotPrivacy } from "./thumbs/ExtShots";
import { Promo, PROMO_FPS, PROMO_FRAMES } from "./video/Promo";

export const RemotionRoot: React.FC = () => (
	<>
		<Still id="thumb-hero" component={ThumbHero} width={1920} height={1080} />
		<Still id="thumb-modes" component={ThumbModes} width={1920} height={1080} />
		<Still id="thumb-dashboard" component={ThumbDashboard} width={1920} height={1080} />
		<Still id="thumb-wide" component={ThumbWide} width={1920} height={960} />
		{/* Chrome Web Store screenshots for the Watch Sync extension. */}
		<Still id="ext-follow" component={ExtShotFollow} width={1280} height={800} />
		<Still id="ext-how" component={ExtShotHow} width={1280} height={800} />
		<Still id="ext-privacy" component={ExtShotPrivacy} width={1280} height={800} />
		<Composition
			id="promo"
			component={Promo}
			width={1920}
			height={1080}
			fps={PROMO_FPS}
			durationInFrames={PROMO_FRAMES}
		/>
	</>
);
