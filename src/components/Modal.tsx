import React, { useEffect } from 'react';
import { createPortal } from 'react-dom'; // Importante para o "teleporte"
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
  // Impede o scroll da página ao fundo quando o modal está aberto
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  if (!isOpen) return null;

  // O createPortal envia o HTML para o final do <body>
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex justify-center items-start pt-10 pb-10 bg-slate-900/60 backdrop-blur-md overflow-y-auto animate-in fade-in duration-300">
      
      {/* Container da Janela */}
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col my-4 md:my-0 animate-in zoom-in-95 duration-200 border border-slate-200">
        
        {/* Cabeçalho Fixo */}
        <div className="flex justify-between items-center p-6 border-b border-slate-100 flex-shrink-0">
          <h3 className="text-xl font-bold text-slate-800">{title}</h3>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-red-600 hover:bg-red-50 p-2 rounded-full transition-all"
          >
            <X size={24} />
          </button>
        </div>
        
        {/* Conteúdo */}
        <div className="p-8">
          {children}
        </div>
      </div>
    </div>,
    document.body // Alvo do teleporte
  );
};

export default Modal;