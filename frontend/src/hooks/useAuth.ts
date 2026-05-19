import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useAuth() {
  return useQuery({
    queryKey: ['auth'],
    queryFn: async () => {
      const { data } = await api.get('/v1/auth/me');
      return data;
    },
    retry: false,
  });
}
