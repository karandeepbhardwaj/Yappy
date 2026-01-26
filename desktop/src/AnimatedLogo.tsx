export default function AnimatedLogo({ size = 28 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width={size} height={size} style={{ pointerEvents: 'none', display: 'block' }}>
      <g stroke="#FF8C00" strokeWidth="8" strokeLinecap="round">
        <line x1="100" y1="15" x2="100" y2="35"/>
        <line x1="100" y1="165" x2="100" y2="185"/>
        <line x1="15" y1="100" x2="35" y2="100"/>
        <line x1="165" y1="100" x2="185" y2="100"/>
        <line x1="40" y1="40" x2="54" y2="54"/>
        <line x1="160" y1="160" x2="146" y2="146"/>
        <line x1="40" y1="160" x2="54" y2="146"/>
        <line x1="160" y1="40" x2="146" y2="54"/>
        <animateTransform attributeName="transform" type="rotate" values="0 100 100; 360 100 100" dur="24s" repeatCount="indefinite"/>
      </g>
      <circle cx="100" cy="100" r="45" fill="#FFD700" stroke="#FF8C00" strokeWidth="4"/>
      <path fill="none" stroke="#FF8C00" strokeWidth="6" strokeLinecap="round">
        <animate attributeName="d" values="M 58 105 C 40 105 40 85 55 85;M 58 105 C 40 105 40 85 55 85;M 58 105 C 65 125 80 125 90 120;M 58 105 C 65 125 80 125 90 120;M 58 105 C 50 120 50 130 58 135;M 58 105 C 50 120 50 130 58 135;M 58 105 C 40 105 40 85 55 85" keyTimes="0;0.3;0.35;0.63;0.68;0.95;1" dur="12s" repeatCount="indefinite"/>
      </path>
      <path fill="none" stroke="#FF8C00" strokeWidth="6" strokeLinecap="round">
        <animate attributeName="d" values="M 142 105 C 150 120 150 130 142 135;M 142 105 C 150 120 150 130 142 135;M 142 105 C 150 120 150 130 142 135;M 142 105 C 150 120 150 130 142 135;M 142 105 C 150 120 140 150 105 160;M 142 105 C 150 120 140 150 105 160;M 142 105 C 150 120 150 130 142 135" keyTimes="0;0.3;0.35;0.63;0.68;0.95;1" dur="12s" repeatCount="indefinite"/>
      </path>
      <g>
        <circle cx="85" cy="90" r="9" fill="#FFF" stroke="#4A3F35" strokeWidth="2"/>
        <circle cx="115" cy="90" r="9" fill="#FFF" stroke="#4A3F35" strokeWidth="2"/>
        <g>
          <circle cx="85" cy="90" r="4" fill="#4A3F35"/>
          <circle cx="115" cy="90" r="4" fill="#4A3F35"/>
          <animateTransform attributeName="transform" type="translate" values="-3,0;-3,0;3,-3;3,-3;0,4;0,4;-3,0" keyTimes="0;0.3;0.35;0.63;0.68;0.95;1" dur="12s" repeatCount="indefinite"/>
        </g>
        <path d="M 82 105 Q 100 125 118 105" fill="none" stroke="#4A3F35" strokeWidth="3" strokeLinecap="round"/>
      </g>
      <g stroke="#FF8C00" strokeWidth="3" strokeLinecap="round" fill="none">
        <path d="M 35 75 Q 40 85 35 95"/>
        <path d="M 28 70 Q 35 85 28 100"/>
        <animate attributeName="opacity" values="1;1;0;0;0;0;1" keyTimes="0;0.3;0.35;0.63;0.68;0.95;1" dur="12s" repeatCount="indefinite"/>
      </g>
      <g fill="#FFF" stroke="#FF8C00" strokeWidth="2">
        <circle cx="120" cy="65" r="4" stroke="none" fill="#FFF"/>
        <circle cx="130" cy="55" r="6"/>
        <path d="M 140 45 C 140 25, 180 25, 180 45 C 180 65, 140 65, 140 45 Z"/>
        <circle cx="150" cy="45" r="2.5" fill="#FF8C00" stroke="none"/>
        <circle cx="160" cy="45" r="2.5" fill="#FF8C00" stroke="none"/>
        <circle cx="170" cy="45" r="2.5" fill="#FF8C00" stroke="none"/>
        <animate attributeName="opacity" values="0;0;1;1;0;0;0" keyTimes="0;0.3;0.35;0.63;0.68;0.95;1" dur="12s" repeatCount="indefinite"/>
      </g>
      <g fill="#FF8C00">
        <path d="M 95 175 L 105 175 L 100 185 Z"/>
        <rect x="98" y="165" width="4" height="10"/>
        <animateTransform attributeName="transform" type="translate" values="0,0;0,0;0,0;0,0;0,0;0,4;0,0;0,4;0,0;0,4;0,0" keyTimes="0;0.3;0.35;0.63;0.68;0.73;0.78;0.83;0.88;0.93;1" dur="12s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0;0;0;0;1;1;0" keyTimes="0;0.3;0.35;0.63;0.68;0.95;1" dur="12s" repeatCount="indefinite"/>
      </g>
    </svg>
  );
}
