export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface User {
  id: number;
  email: string;
  full_name: string | null;
  is_active: boolean;
}
