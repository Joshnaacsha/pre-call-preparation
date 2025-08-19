import { useState, useCallback } from 'react';
import { apiService } from '../services/api';
import toast from 'react-hot-toast';

export function useApi() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async <T>(
    apiCall: () => Promise<{ success: boolean; data: T; message?: string }>,
    options: { 
      showToast?: boolean; 
      loadingMessage?: string; 
      successMessage?: string; 
    } = {}
  ) => {
    setIsLoading(true);
    setError(null);

    const { showToast = true, loadingMessage, successMessage } = options;
    let toastId: string | undefined;

    if (showToast && loadingMessage) {
      toastId = toast.loading(loadingMessage);
    }

    try {
      const result = await apiCall();
      
      if (result.success) {
        if (showToast && successMessage) {
          if (toastId) toast.success(successMessage, { id: toastId });
          else toast.success(successMessage);
        } else if (toastId) {
          toast.dismiss(toastId);
        }
        return result.data;
      } else {
        const errorMessage = result.message || 'Something went wrong';
        setError(errorMessage);
        if (showToast) {
          if (toastId) toast.error(errorMessage, { id: toastId });
          else toast.error(errorMessage);
        }
        return null;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Network error';
      setError(errorMessage);
      if (showToast) {
        if (toastId) toast.error(errorMessage, { id: toastId });
        else toast.error(errorMessage);
      }
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { execute, isLoading, error };
}