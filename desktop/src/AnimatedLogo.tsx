/**
 * Animated SunYapper mascot.
 * phase controls which gesture is shown:
 *   "idle"       – full loop animation
 *   "recording"  – paused at listening pose (sound waves visible)
 *   "processing" – paused at thinking pose (speech bubble visible)
 *   "done"       – paused at pointing-down pose
 */
export default function AnimatedLogo({
  size = 100,
  phase = "idle",
}: {
  size?: number;
  phase?: "idle" | "recording" | "processing" | "done";
}) {
  const showWaves = phase === "idle" || phase === "recording";
  const showBubble = phase === "processing";
  const showPointing = phase === "done";

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 200 200"
      width={size}
      height={size}
      style={{ display: "block" }}
    >
      {/* Rays - always rotate when idle/recording, still otherwise */}
      <g stroke="#FF8C00" strokeWidth="8" strokeLinecap="round">
        <line x1="100" y1="15" x2="100" y2="35" />
        <line x1="100" y1="165" x2="100" y2="185" />
        <line x1="15" y1="100" x2="35" y2="100" />
        <line x1="165" y1="100" x2="185" y2="100" />
        <line x1="40" y1="40" x2="54" y2="54" />
        <line x1="160" y1="160" x2="146" y2="146" />
        <line x1="40" y1="160" x2="54" y2="146" />
        <line x1="160" y1="40" x2="146" y2="54" />
        {(phase === "idle" || phase === "recording") && (
          <animateTransform
            attributeName="transform"
            type="rotate"
            values="0 100 100;360 100 100"
            dur="24s"
            repeatCount="indefinite"
          />
        )}
      </g>

      {/* Sun body */}
      <circle cx="100" cy="100" r="45" fill="#FFD700" stroke="#FF8C00" strokeWidth="4" />

      {/* Left arm */}
      <path
        fill="none"
        stroke="#FF8C00"
        strokeWidth="6"
        strokeLinecap="round"
        d={
          showWaves
            ? "M 58 105 C 40 105 40 85 55 85"
            : showBubble
            ? "M 58 105 C 65 125 80 125 90 120"
            : "M 58 105 C 50 120 50 130 58 135"
        }
      />

      {/* Right arm */}
      <path
        fill="none"
        stroke="#FF8C00"
        strokeWidth="6"
        strokeLinecap="round"
        d={
          showPointing
            ? "M 142 105 C 150 120 140 150 105 160"
            : "M 142 105 C 150 120 150 130 142 135"
        }
      />

      {/* Face */}
      <g>
        {/* Eyes */}
        <circle cx="85" cy="90" r="9" fill="#FFF" stroke="#4A3F35" strokeWidth="2" />
        <circle cx="115" cy="90" r="9" fill="#FFF" stroke="#4A3F35" strokeWidth="2" />
        {/* Pupils - position based on state */}
        <g
          transform={
            showWaves
              ? "translate(-3,0)"
              : showBubble
              ? "translate(3,-3)"
              : "translate(0,4)"
          }
        >
          <circle cx="85" cy="90" r="4" fill="#4A3F35" />
          <circle cx="115" cy="90" r="4" fill="#4A3F35" />
        </g>
        {/* Mouth */}
        <path
          d="M 82 105 Q 100 125 118 105"
          fill="none"
          stroke="#4A3F35"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>

      {/* Sound waves - visible when listening/recording */}
      {showWaves && (
        <g stroke="#FF8C00" strokeWidth="3" strokeLinecap="round" fill="none">
          <path d="M 35 75 Q 40 85 35 95" />
          <path d="M 28 70 Q 35 85 28 100" />
          {phase === "recording" && (
            <animate
              attributeName="opacity"
              values="1;0.4;1"
              dur="1.2s"
              repeatCount="indefinite"
            />
          )}
        </g>
      )}

      {/* Speech bubble - visible when thinking/processing */}
      {showBubble && (
        <g fill="#FFF" stroke="#FF8C00" strokeWidth="2">
          <circle cx="120" cy="65" r="4" stroke="none" fill="#FFF" />
          <circle cx="130" cy="55" r="6" />
          <path d="M 140 45 C 140 25, 180 25, 180 45 C 180 65, 140 65, 140 45 Z" />
          {/* Animated dots */}
          <circle cx="150" cy="45" r="2.5" fill="#FF8C00" stroke="none">
            <animate attributeName="opacity" values="1;0.2;1" dur="1.5s" repeatCount="indefinite" />
          </circle>
          <circle cx="160" cy="45" r="2.5" fill="#FF8C00" stroke="none">
            <animate
              attributeName="opacity"
              values="0.2;1;0.2"
              dur="1.5s"
              repeatCount="indefinite"
            />
          </circle>
          <circle cx="170" cy="45" r="2.5" fill="#FF8C00" stroke="none">
            <animate
              attributeName="opacity"
              values="0.5;0.2;1;0.5"
              dur="1.5s"
              repeatCount="indefinite"
            />
          </circle>
        </g>
      )}

      {/* Pointing foot - visible when done */}
      {showPointing && (
        <g fill="#FF8C00">
          <path d="M 95 175 L 105 175 L 100 185 Z" />
          <rect x="98" y="165" width="4" height="10" />
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0,0;0,4;0,0"
            dur="0.6s"
            repeatCount="indefinite"
          />
        </g>
      )}
    </svg>
  );
}
