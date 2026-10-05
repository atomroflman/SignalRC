import React, { useState } from "react";
import { useControlFlowStore } from "./control-flow-store";
import { useI18n } from "@/i18n/provider";

export default function SessionTransfer() {
  const { messages } = useI18n();
  const [transferCode, setTransferCode] = useState<string>("");
  const [generatedCode, setGeneratedCode] = useState<string>("");
  const [showTransfer, setShowTransfer] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  
  const flowControl = useControlFlowStore();

  // Generate a transfer code for the current session
  const generateTransferCode = async () => {
    setError("");
    setStatus(messages.sessionTransfer.generating);
    
    try {
      // Get current session data
      const sessionData = {
        carId: flowControl.carId,
        userSetupId: flowControl.userSetupId,
        timestamp: Date.now()
      };
      
      // Create transfer code via API
      const response = await fetch('/api/user/generate-transfer-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sessionData),
      });
      
      if (!response.ok) {
        throw new Error(messages.sessionTransfer.generateFailed);
      }
      
      const data = await response.json();
      setGeneratedCode(data.transferCode);
      setStatus(messages.sessionTransfer.generated);
    } catch (e: any) {
      setError(e.message || messages.sessionTransfer.generateFailed);
      setStatus("");
    }
  };

  // Apply a transfer code to restore session on this device
  const applyTransferCode = async () => {
    if (!transferCode.trim()) {
      setError(messages.sessionTransfer.enterCodeError);
      return;
    }
    
    setError("");
    setStatus(messages.sessionTransfer.applying);
    
    try {
      // Restore session from transfer code
      const response = await fetch('/api/user/apply-transfer-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transferCode: transferCode.trim() }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || messages.sessionTransfer.invalidOrExpired);
      }
      
      const data = await response.json();
      
      // Update the flow control store with transferred session
      flowControl.setCarId(data.carId);
      flowControl.load(data.carId);
      
      setStatus(messages.sessionTransfer.applied);
      setTransferCode("");
      
      // Reload the page after a short delay
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (e: any) {
      setError(e.message || messages.sessionTransfer.applyFailed);
      setStatus("");
    }
  };

  // Copy transfer code to clipboard
  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(generatedCode);
      setStatus(messages.sessionTransfer.copied);
      setTimeout(() => setStatus(messages.sessionTransfer.generated), 2000);
    } catch (e) {
      setError(messages.sessionTransfer.copyFailed);
    }
  };

  return (
    <div className="mt-2 bg-zinc-900 text-zinc-100 rounded-lg border border-zinc-800 text-xs leading-tight">
      <button
        className="mb-2 px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs border border-zinc-700 transition-colors duration-150 w-full flex items-center justify-between"
        onClick={() => setShowTransfer(!showTransfer)}
        aria-label={showTransfer ? messages.common.collapseSection(messages.sessionTransfer.title) : messages.common.expandSection(messages.sessionTransfer.title)}
        style={showTransfer ? {} : { marginBottom: 0 }}
      >
        <span>🔄 {messages.sessionTransfer.title}</span>
        <span className="ml-2">{showTransfer ? '▲' : '▼'}</span>
      </button>
      
      {showTransfer && (
        <div className="px-2 pb-2 space-y-3">
          {/* Generate Transfer Code Section */}
          <div className="bg-zinc-800 border border-zinc-700 rounded p-2">
            <h3 className="text-xs font-bold text-cyan-300 mb-2">📤 {messages.sessionTransfer.exportTitle}</h3>
            <p className="text-xs text-zinc-400 mb-2">
              {messages.sessionTransfer.exportDescription}
            </p>
            
            <button
              className="w-full px-2 py-1 bg-cyan-800 hover:bg-cyan-700 text-cyan-100 rounded text-xs border border-cyan-700 transition-colors duration-150 mb-2"
              onClick={generateTransferCode}
            >
              {messages.sessionTransfer.generateCode}
            </button>
            
            {generatedCode && (
              <div className="bg-zinc-900 border border-cyan-700 rounded p-2 mb-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-zinc-400">{messages.sessionTransfer.transferCode}</span>
                  <button
                    className="px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded text-[10px]"
                    onClick={copyToClipboard}
                    title={messages.sessionTransfer.copyToClipboard}
                  >
                    📋 {messages.common.copy}
                  </button>
                </div>
                <div className="font-mono text-lg text-cyan-300 text-center break-all">
                  {generatedCode}
                </div>
                <div className="text-xs text-zinc-500 mt-1 text-center">
                  {messages.sessionTransfer.validForFiveMinutes}
                </div>
              </div>
            )}
          </div>
          
          {/* Apply Transfer Code Section */}
          <div className="bg-zinc-800 border border-zinc-700 rounded p-2">
            <h3 className="text-xs font-bold text-green-300 mb-2">📥 {messages.sessionTransfer.importTitle}</h3>
            <p className="text-xs text-zinc-400 mb-2">
              {messages.sessionTransfer.importDescription}
            </p>
            
            <input
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 mb-2 focus:border-green-500 focus:outline-none font-mono"
              value={transferCode}
              onChange={(e) => setTransferCode(e.target.value)}
              placeholder={messages.sessionTransfer.enterCode}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  applyTransferCode();
                }
              }}
            />
            
            <button
              className="w-full px-2 py-1 bg-green-800 hover:bg-green-700 text-green-100 rounded text-xs border border-green-700 transition-colors duration-150"
              onClick={applyTransferCode}
              disabled={!transferCode.trim()}
            >
              {messages.sessionTransfer.applyCode}
            </button>
          </div>
          
          {/* Status Messages */}
          {status && (
            <div className="bg-blue-900 border border-blue-700 rounded p-2 text-xs text-blue-200">
              {status}
            </div>
          )}
          
          {error && (
            <div className="bg-red-900 border border-red-700 rounded p-2 text-xs text-red-200">
              ❌ {error}
            </div>
          )}
          
          {/* Info Section */}
          <div className="bg-zinc-800 border border-zinc-700 rounded p-2">
            <h4 className="text-xs font-bold text-zinc-300 mb-1">ℹ️ {messages.sessionTransfer.howItWorks}</h4>
            <ul className="text-xs text-zinc-400 space-y-1 list-disc list-inside">
              <li>{messages.sessionTransfer.howStepOne}</li>
              <li>{messages.sessionTransfer.howStepTwo}</li>
              <li>{messages.sessionTransfer.howStepThree}</li>
              <li>{messages.sessionTransfer.howStepFour}</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

