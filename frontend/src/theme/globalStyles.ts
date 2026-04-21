import { createGlobalStyle } from 'styled-components';
import { tokens } from './tokens';

export const GlobalStyles = createGlobalStyle`
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  html, body, #root {
    height: 100%;
    width: 100%;
  }

  body {
    font-family: ${tokens.fonts.body};
    background-color: ${tokens.colors.bg.primary};
    color: ${tokens.colors.text.primary};
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    line-height: 1.6;
  }

  h1, h2, h3, h4, h5, h6 {
    font-family: ${tokens.fonts.display};
    font-weight: 600;
    line-height: 1.3;
  }

  button {
    font-family: ${tokens.fonts.accent};
  }

  code, pre {
    font-family: ${tokens.fonts.mono};
  }

  a {
    color: ${tokens.colors.accent.secondary};
    text-decoration: none;
    &:hover {
      text-decoration: underline;
    }
  }

  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  ::-webkit-scrollbar-track {
    background: ${tokens.colors.bg.secondary};
  }
  ::-webkit-scrollbar-thumb {
    background: ${tokens.colors.border.strong};
    border-radius: 4px;
  }
`;
