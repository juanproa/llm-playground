export const tokens = {
  colors: {
    bg: {
      primary: '#0A0A0F',
      secondary: '#12121A',
      tertiary: '#1A1A25',
      hover: '#22222F',
    },
    accent: {
      primary: '#6C5CE7',
      primaryHover: '#7D6FF0',
      secondary: '#00D2FF',
      success: '#00E676',
      warning: '#FFD600',
      error: '#FF5252',
    },
    text: {
      primary: '#F0F0F5',
      secondary: '#9999AA',
      muted: '#666677',
    },
    border: {
      subtle: '#2A2A3A',
      strong: '#3A3A4A',
    },
  },
  fonts: {
    display: "'Comfortaa', cursive",
    body: "'Manrope', sans-serif",
    mono: "'JetBrains Mono', monospace",
    accent: "'Poppins', sans-serif",
  },
  radii: {
    sm: '6px',
    md: '10px',
    lg: '16px',
    xl: '20px',
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
    xxl: '48px',
  },
  shadows: {
    card: '0 4px 24px rgba(0, 0, 0, 0.4)',
    elevated: '0 8px 32px rgba(0, 0, 0, 0.6)',
  },
};

export type Theme = typeof tokens;
