"use client";

import React, { useEffect, useState } from "react";
import { useControlFlowStore } from "./control-flow-store";
import { useRouter } from "next/router";
import { useI18n } from "@/i18n/provider";

interface ConfigGuardProps {
  children: React.ReactNode;
  carId: number;
}

export default function ConfigGuard({ children, carId }: ConfigGuardProps) {
  const { messages } = useI18n();
  const { hasAuthenticatedWithCar } = useControlFlowStore();
  const router = useRouter();
  const [hasServerAccess, setHasServerAccess] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkServerAccess = async () => {
      try {
        const response = await fetch(`/api/userconfig/has-config-access/${carId}`);
        if (response.ok) {
          const data = await response.json();
          setHasServerAccess(data.hasAccess);
        } else {
          setHasServerAccess(false);
        }
      } catch (error) {
        console.error("Failed to check server config access:", error);
        setHasServerAccess(false);
      } finally {
        setIsLoading(false);
      }
    };

    if (carId) {
      checkServerAccess();
    }
  }, [carId]);

  // Show loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-950 text-white p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-300">{messages.configGuard.checkingAccess}</p>
        </div>
      </div>
    );
  }

  // Check both local authentication and server access
  const hasLocalAccess = hasAuthenticatedWithCar(carId);
  const hasAccess = hasLocalAccess || hasServerAccess;

  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-950 text-white p-8">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold mb-4 text-red-400">{messages.configGuard.accessDenied}</h1>
          <p className="text-gray-300 mb-6">
            {messages.configGuard.authenticationRequired}
          </p>
          <p className="text-sm text-gray-400 mb-8">
            {messages.configGuard.returnToMainHint}
          </p>
          <button
            onClick={() => router.push("/")}
            className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
          >
            {messages.configGuard.goToMainPage}
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
