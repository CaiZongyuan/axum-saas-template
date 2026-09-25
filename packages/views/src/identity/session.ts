import { queryOptions } from '@tanstack/react-query';
import { getCurrentSession, type ApiClient } from '@saas/sdk';

export const sessionKey = (api: ApiClient) =>
  ['session', api.getConfig().baseUrl] as const;

export function sessionQuery(api: ApiClient) {
  return queryOptions({
    queryKey: sessionKey(api),
    queryFn: async ({ signal }) => {
      const result = await getCurrentSession({ client: api, signal });
      if (result.response?.status === 401) return null;
      if (result.error) throw result.error;
      if (!result.data) throw new Error('Missing session response');
      return result.data;
    },
    retry: false,
    staleTime: 0,
  });
}
