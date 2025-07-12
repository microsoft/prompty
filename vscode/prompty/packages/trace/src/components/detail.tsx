import { Time, Usage } from "../store";
import styled from "styled-components";
import { formatDuration, formatTokens } from "../utilities/format";

const Frame = styled.div`
  display: flex;
  flex-direction: row;
  border: 1px solid var(--vscode-textBlockQuote-border);
  border-radius: 8px;
  flex-wrap: wrap;
  margin: 18px;
	overflow: hidden;
`;

const DetailItem = styled.div`
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--vscode-textBlockQuote-border);
  padding: 12px;
  flex-grow: 1;
  &:last-child {
    border-right: none;
  }
`;

const DetailLabel = styled.div`
  font-size: smaller;
  color: var(--vscode-descriptionForeground);
`;

const DetailValue = styled.div`
  font-weight: 600;
  font-size: larger;
  
`;

const Measure = styled.span`
  font-size: larger;
`;

const Unit = styled.span`
  font-size: medium;
  color: var(--vscode-descriptionForeground);
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
