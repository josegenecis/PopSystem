
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { isStaleChunkError, recoverFromStaleChunk } from '@/utils/chunkRecovery';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ errorInfo });
    if (isStaleChunkError(error)) void recoverFromStaleChunk(error);
  }

  public render() {
    if (this.state.hasError) {
      const staleVersion = isStaleChunkError(this.state.error);
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4 text-center">
          <div className="bg-white p-8 rounded-xl shadow-lg max-w-lg w-full">
            <div className="mx-auto bg-red-100 w-16 h-16 rounded-full flex items-center justify-center mb-6">
              <AlertTriangle className="h-8 w-8 text-red-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">{staleVersion ? 'Atualizando o PopSystem' : 'Algo deu errado'}</h1>
            <p className="text-gray-600 mb-6">
              {staleVersion ? 'Uma versão nova foi encontrada. A página será atualizada automaticamente.' : 'Ocorreu um erro inesperado na aplicação.'}
            </p>
            
            <div className="bg-gray-100 p-4 rounded-lg text-left mb-6 overflow-auto max-h-60">
              <p className="font-mono text-xs text-red-600 break-words">
                {this.state.error?.toString()}
              </p>
              {this.state.errorInfo && (
                <pre className="font-mono text-xs text-gray-500 mt-2 whitespace-pre-wrap">
                  {this.state.errorInfo.componentStack}
                </pre>
              )}
            </div>

            <div className="flex gap-3 justify-center">
              <Button onClick={() => window.location.reload()} variant="default">
                <RefreshCw className="mr-2 h-4 w-4" />
                Recarregar Página
              </Button>
              <Button onClick={() => window.location.href = '/'} variant="outline">
                Ir para Início
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
