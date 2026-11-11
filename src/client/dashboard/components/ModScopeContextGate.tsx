import React, { ReactNode } from 'react';
import { AppContext, getAppContext } from '../utils/context';

export interface ModScopeContextGateProps {
  requiredContext: AppContext | AppContext[];
  children: ReactNode;
}

export const ModScopeContextGate: React.FC<ModScopeContextGateProps> = ({
  requiredContext,
  children,
}) => {
  const currentContext = getAppContext();

  const isAllowed = Array.isArray(requiredContext)
    ? requiredContext.includes(currentContext)
    : requiredContext === currentContext;

  if (!isAllowed) {
    return null;
  }

  return <>{children}</>;
};
