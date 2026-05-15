import { templates } from '../../data/templates';
import { useCanvasStore } from '../../store/canvasStore';

export function EmptyState() {
  const importCanvas = useCanvasStore((state) => state.importCanvas);

  const handleSelectTemplate = (templateId: string) => {
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    importCanvas(template.canvas);
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
      <div className="pointer-events-auto bg-white rounded-xl shadow-lg border border-paper-100 p-4 sm:p-6 max-w-sm sm:max-w-md w-full mx-4">
        <div className="text-center mb-3 sm:mb-4">
          <h2 className="text-lg sm:text-xl font-semibold text-bridge-800 mb-1">Welcome to Paperbridge</h2>
          <p className="text-sm text-bridge-500">
            Drop a PDF or image to start, or pick a template.
          </p>
        </div>

        <div className="grid gap-2">
          {templates.map((template) => (
            <button
              key={template.id}
              onClick={() => handleSelectTemplate(template.id)}
              className="text-left p-3 rounded-lg border border-paper-200 hover:border-copper-400 hover:bg-copper-400/10 transition-colors group"
            >
              <div className="font-medium text-sm text-bridge-800 group-hover:text-copper-600">
                {template.name}
              </div>
              <div className="text-xs text-bridge-500 mt-0.5">
                {template.description}
              </div>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {template.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs px-1.5 py-0.5 bg-paper-100 text-bridge-500 rounded-full"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>

        <p className="text-center text-xs text-bridge-400 mt-3">
          Use the toolbar below to add nodes manually.
        </p>

        <div className="mt-3 pt-3 border-t border-paper-100 text-center">
          <a
            href="mailto:barryzmeng@gmail.com?subject=Integrating%20Paperbridge%20into%20our%20practice"
            className="text-xs font-medium text-copper-600 hover:text-copper-700 hover:underline underline-offset-4"
          >
            Contact me to discuss how to integrate this tool into your business
          </a>
        </div>
      </div>
    </div>
  );
}
