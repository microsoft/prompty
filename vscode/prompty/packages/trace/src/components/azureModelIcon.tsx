import styled from "styled-components";

const Icon = styled.div<{ $size?: number }>`
  display: flex;
  justify-content: center;
  align-items: center;
  width: ${(props) => (props.$size ? props.$size : 16)}px;
  height: ${(props) => (props.$size ? props.$size : 16)}px;
`;

type Props = {
  size: number;
};



const AzureModelIcon = ({  size }: Props) => {
  return (
    <Icon $size={size}>
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          fill-rule="evenodd"
          clip-rule="evenodd"
          d="M0 12v56c0 6.6266 5.37329 12 12 12h56c6.6267 0 12-5.3734 12-12V12c0-6.62668-5.3733-12-12-12H12C5.37329 0 0 5.37332 0 12ZM48 0v16c0 17.6711 14.3289 32 32 32H64c-17.6711 0-31.9955 14.32-32 31.9911V64c0-17.6711-14.3289-32-32-32h16c17.6711 0 32-14.3289 32-32Z"
          fill="url(#a)"
        />
        <defs>
          <radialGradient
            id="a"
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="rotate(45 -27.56025626 63.06856808) scale(50.182 68.298)">
            <stop stop-color="#83B9F9" />
            <stop offset="1" stop-color="#0078D4" />
          </radialGradient>
        </defs>
      </svg>
    </Icon>
  );
};

export default AzureModelIcon;
