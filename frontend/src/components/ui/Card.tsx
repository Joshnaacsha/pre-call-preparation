import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../utils/index';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
}

export function Card({ children, className, hover = true, onClick }: CardProps) {
  const Component = onClick ? motion.div : 'div';
  
  return (
    <Component
      className={cn(
        'bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl border border-gray-200/20 dark:border-gray-700/20 rounded-2xl shadow-xl',
        hover && 'hover:shadow-2xl transition-all duration-300',
        onClick && 'cursor-pointer',
        className
      )}
      onClick={onClick}
      {...(onClick && {
        whileHover: { scale: 1.02, y: -4 },
        whileTap: { scale: 0.98 },
      })}
    >
      {children}
    </Component>
  );
}