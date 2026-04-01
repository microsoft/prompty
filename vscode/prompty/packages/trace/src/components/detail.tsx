import { Time, Usage } from "../store";
import styled from "styled-components";
import { formatDuration, formatTokens } from "../utilities/format";

const Frame = styled.div`
  display: flex;
  flex-wrap: wrap;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  background: var(--vscode-editor-background);
  overflow: hidden;
  flex-shrink: 0;
`;

const DetailItem = styled.div`
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--vscode-panel-border);
  padding: 8px 12px;
  flex: 1 1 0;
  min-width: 100px;
  &:last-child {
    border-right: none;
  }
`;

const DetailLabel = styled.div`
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 2px;
  white-space: nowrap;
`;

const DetailValue = styled.div`
  font-weight: 600;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  white-space: nowrap;
`;

const Measure = styled.span`
  font-size: 15px;
`;

const Unit = styled.span`
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  margin-left: 2px;
`;

interface Props {
  time: Time;
  usage?: Usage;
}

const TokenItem = ({ title, value }: { title: string; value: number }) => {
  const tokens = formatTokens(value);
  return (
    <DetailItem>
      <DetailLabel>{title}</DetailLabel>
      <DetailValue>
        <Measure>{tokens.measure}</Measure>
        <Unit>{tokens.unit}</Unit>
      </DetailValue>
    </DetailItem>
  );
};

const Detail = ({ time, usage }: Props) => {
  const duration = formatDuration(time.duration);

  return (
    <Frame>
      <DetailItem>
        <DetailLabel>Total Time</DetailLabel>
        <DetailValue>
          <Measure>{duration.measure}</Measure>
          <Unit>{duration.unit}</Unit>
        </DetailValue>
      </DetailItem>

      {usage && (
        <>
          <TokenItem title="Prompt Tokens" value={usage.prompt_tokens} />
          {usage.completion_tokens && (
            <TokenItem
              title="Completion Tokens"
              value={usage.completion_tokens}
            />
          )}
          <TokenItem title="Total Tokens" value={usage.total_tokens} />
        </>
      )}
    </Frame>
  );
};

export default Detail;
