import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Building2,
  FileText,
  Landmark,
  ReceiptText,
  Settings2,
  ShieldCheck,
  Users,
  Workflow,
} from "lucide-react";
import FiscalSettings from "@/components/fiscal/FiscalSettings";
import NFCeManager from "@/components/nfce/NFCeManager";
import { useSearchParams } from "react-router-dom";
import FiscalDocumentModelSettings from "@/components/fiscal/FiscalDocumentModelSettings";
import FiscalRecipientsManager from "@/components/fiscal/FiscalRecipientsManager";
import FiscalRtcValidation from "@/components/fiscal/FiscalRtcValidation";
import FiscalOperationsManager from "@/components/fiscal/FiscalOperationsManager";

const Fiscal = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab = [
    "issuer",
    "models",
    "recipients",
    "operations",
    "rtc",
    "documents",
  ].includes(String(requestedTab))
    ? String(requestedTab)
    : "issuer";

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl bg-gradient-to-r from-slate-950 via-slate-900 to-emerald-950 p-6 text-white shadow-lg">
        <div className="flex items-center gap-4">
          <span className="rounded-xl bg-white/10 p-3">
            <Landmark className="h-7 w-7 text-emerald-300" />
          </span>
          <div>
            <h1 className="text-2xl font-bold">Configurações fiscais</h1>
            <p className="mt-1 text-sm text-slate-300">
              Configure o emitente e as regras de cada modelo de documento
              fiscal.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-blue-500/20 px-3 py-1 text-blue-100">
            NF-e • Modelo 55
          </span>
          <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-emerald-100">
            NFC-e • Modelo 65
          </span>
          <span className="rounded-full bg-white/10 px-3 py-1 text-slate-200">
            Certificado A1 compartilhado
          </span>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams);
          next.set("tab", value);
          setSearchParams(next);
        }}
        className="w-full"
      >
        <TabsList>
          <TabsTrigger value="issuer" className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Emitente e certificado
          </TabsTrigger>
          <TabsTrigger value="models" className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Modelos e numeração
          </TabsTrigger>
          <TabsTrigger value="recipients" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Destinatários NF-e
          </TabsTrigger>
          <TabsTrigger value="operations" className="flex items-center gap-2">
            <Workflow className="h-4 w-4" />
            Operações fiscais
          </TabsTrigger>
          <TabsTrigger value="rtc" className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            IBS, CBS e IS
          </TabsTrigger>
          <TabsTrigger value="documents" className="flex items-center gap-2">
            <ReceiptText className="h-4 w-4" />
            Cupons e documentos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="issuer">
          <FiscalSettings
            modelSettingsVisible={false}
            recentDocumentsVisible={false}
          />
        </TabsContent>
        <TabsContent value="models">
          <FiscalDocumentModelSettings />
        </TabsContent>
        <TabsContent value="recipients">
          <FiscalRecipientsManager />
        </TabsContent>
        <TabsContent value="operations">
          <FiscalOperationsManager />
        </TabsContent>
        <TabsContent value="rtc">
          <FiscalRtcValidation />
        </TabsContent>
        <TabsContent value="documents" className="space-y-4">
          <div className="rounded-xl border bg-white p-4">
            <div className="flex items-center gap-2 font-semibold">
              <FileText className="h-4 w-4 text-emerald-600" />
              Documentos emitidos
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Consulte, imprima, cancele e acompanhe documentos por modelo e
              situação.
            </p>
          </div>
          <NFCeManager />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Fiscal;
