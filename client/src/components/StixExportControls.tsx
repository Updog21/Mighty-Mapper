import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { downloadStixJson, downloadStixMarkdown } from "@/lib/stix-export";
import { FileJson2, FileText } from "lucide-react";

interface StixExportControlsProps {
  baseName: string;
  jsonPayload: unknown;
  markdownContent: string;
  disabled?: boolean;
}

export function StixExportControls({
  baseName,
  jsonPayload,
  markdownContent,
  disabled = false,
}: StixExportControlsProps) {
  const { toast } = useToast();

  const onExportJson = () => {
    try {
      downloadStixJson(baseName, jsonPayload);
      toast({
        title: "Exported JSON",
        description: "STIX data was downloaded as JSON.",
      });
    } catch {
      toast({
        title: "Export failed",
        description: "Unable to export JSON.",
        variant: "destructive",
      });
    }
  };

  const onExportMarkdown = () => {
    try {
      downloadStixMarkdown(baseName, markdownContent);
      toast({
        title: "Exported Markdown",
        description: "STIX data was downloaded as Markdown.",
      });
    } catch {
      toast({
        title: "Export failed",
        description: "Unable to export Markdown.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" onClick={onExportJson} disabled={disabled}>
        <FileJson2 className="w-4 h-4 mr-2" />
        Export JSON
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={onExportMarkdown} disabled={disabled}>
        <FileText className="w-4 h-4 mr-2" />
        Export Markdown
      </Button>
    </div>
  );
}

export default StixExportControls;
