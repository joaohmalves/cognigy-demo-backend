// Um agente Cognigy (Flow) por vertical do DemoHub. Adicione uma linha aqui
// pra cada vertical nova — não precisa mexer em mais nada no código.
export const COGNIGY_AGENTS: Record<string, { endpointUrl: string; urlToken: string }> = {
  banking: {
    endpointUrl: process.env.COGNIGY_BANKING_ENDPOINT_URL ?? '',
    urlToken: process.env.COGNIGY_BANKING_URL_TOKEN ?? '',
  },
  // seguros: {
  //   endpointUrl: process.env.COGNIGY_SEGUROS_ENDPOINT_URL ?? '',
  //   urlToken: process.env.COGNIGY_SEGUROS_URL_TOKEN ?? '',
  // },
};

export function getAgentConfig(vertical: string) {
  const config = COGNIGY_AGENTS[vertical];
  if (!config || !config.endpointUrl || !config.urlToken) return null;
  return config;
}