import type { QuestionType } from "../shared/types/domain";

export interface CatalogQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  options?: string[];
  expectedAnswer: string;
}

export interface CourseCatalogEntry {
  id: string;
  code: string;
  title: string;
  instructor: string;
  description: string;
  recording: {
    id: string;
    title: string;
    durationSeconds: number;
  };
  assignment: {
    id: string;
    title: string;
    questions: CatalogQuestion[];
  };
}

export const COURSE_CATALOG: CourseCatalogEntry[] = [
  {
    id: "course-business",
    code: "BUS101",
    title: "Business Fundamentals",
    instructor: "Maya Rao",
    description: "A practical introduction to revenue, costs, and the decisions that keep a business healthy.",
    recording: {
      id: "recording-business",
      title: "Business Fundamentals Meeting Recording",
      durationSeconds: 28
    },
    assignment: {
      id: "assignment-business",
      title: "Business Fundamentals Assignment",
      questions: [
        {
          id: "q-business-1",
          type: "MULTIPLE_CHOICE",
          prompt: "Which statement best describes revenue?",
          options: [
            "Money earned from sales before expenses",
            "Profit after tax only",
            "The cost of employees",
            "A company's debt"
          ],
          expectedAnswer: "Money earned from sales before expenses"
        },
        {
          id: "q-business-2",
          type: "MULTIPLE_CHOICE",
          prompt: "Which example is usually a fixed cost?",
          options: ["Monthly rent", "Packaging per item", "Sales commission", "Shipping per order"],
          expectedAnswer: "Monthly rent"
        },
        {
          id: "q-business-3",
          type: "TEXT",
          prompt: "Why do businesses track costs?",
          expectedAnswer: "Businesses track costs to understand spending and measure profitability."
        },
        {
          id: "q-business-4",
          type: "TEXT",
          prompt: "Why is cash flow important to a business?",
          expectedAnswer: "Cash flow shows whether a business can cover its short-term obligations."
        }
      ]
    }
  },
  {
    id: "course-econ",
    code: "ECO101",
    title: "Introduction to Economics",
    instructor: "Daniel Brooks",
    description: "Build an everyday understanding of scarcity, demand, and the trade-offs behind choices.",
    recording: {
      id: "recording-econ",
      title: "Economics Meeting Recording",
      durationSeconds: 24
    },
    assignment: {
      id: "assignment-econ",
      title: "Economics Assignment",
      questions: [
        {
          id: "q-econ-1",
          type: "MULTIPLE_CHOICE",
          prompt: "Which concept describes the next best alternative given up when making a choice?",
          options: ["Opportunity cost", "Inflation", "Revenue", "Demand"],
          expectedAnswer: "Opportunity cost"
        },
        {
          id: "q-econ-2",
          type: "MULTIPLE_CHOICE",
          prompt: "What usually happens to demand when a price rises, all else equal?",
          options: ["Demand decreases", "Demand doubles", "Demand becomes revenue", "Demand disappears forever"],
          expectedAnswer: "Demand decreases"
        },
        {
          id: "q-econ-3",
          type: "TEXT",
          prompt: "Explain scarcity in one sentence.",
          expectedAnswer: "Scarcity means limited resources are available to satisfy unlimited wants."
        },
        {
          id: "q-econ-4",
          type: "TEXT",
          prompt: "Give a simple example of a trade-off.",
          expectedAnswer: "Choosing study time over a social activity is a trade-off because one option is given up."
        }
      ]
    }
  },
  {
    id: "course-data",
    code: "DAT110",
    title: "Data Analytics Foundations",
    instructor: "Priya Menon",
    description: "Learn the foundations of trustworthy analysis, from summary statistics to clean inputs.",
    recording: {
      id: "recording-data",
      title: "Data Analytics Foundations Meeting Recording",
      durationSeconds: 22
    },
    assignment: {
      id: "assignment-data",
      title: "Data Analytics Foundations Assignment",
      questions: [
        {
          id: "q-data-1",
          type: "MULTIPLE_CHOICE",
          prompt: "Which measure is the middle value of an ordered dataset?",
          options: ["Median", "Variance", "Range", "Sample size"],
          expectedAnswer: "Median"
        },
        {
          id: "q-data-2",
          type: "MULTIPLE_CHOICE",
          prompt: "What is a sensible first step when a dataset has missing values?",
          options: ["Investigate the pattern of missingness", "Delete every row", "Ignore the issue", "Publish immediately"],
          expectedAnswer: "Investigate the pattern of missingness"
        },
        {
          id: "q-data-3",
          type: "TEXT",
          prompt: "Why should analysts validate data before using it?",
          expectedAnswer: "Validation catches inaccurate or inconsistent inputs before they affect conclusions."
        },
        {
          id: "q-data-4",
          type: "TEXT",
          prompt: "Describe a simple analysis workflow.",
          expectedAnswer: "A simple workflow defines a question, cleans data, analyzes patterns, and communicates findings."
        }
      ]
    }
  },
  {
    id: "course-ai",
    code: "AI120",
    title: "Introduction to Artificial Intelligence",
    instructor: "Alex Morgan",
    description: "Explore core AI ideas, model evaluation, and the habits that make applied systems responsible.",
    recording: {
      id: "recording-ai",
      title: "Introduction to Artificial Intelligence Meeting Recording",
      durationSeconds: 26
    },
    assignment: {
      id: "assignment-ai",
      title: "Introduction to Artificial Intelligence Assignment",
      questions: [
        {
          id: "q-ai-1",
          type: "MULTIPLE_CHOICE",
          prompt: "What is supervised learning trained with?",
          options: ["Labeled examples", "Only random noise", "No data", "A billing system"],
          expectedAnswer: "Labeled examples"
        },
        {
          id: "q-ai-2",
          type: "MULTIPLE_CHOICE",
          prompt: "What is a hallucination in a generative AI system?",
          options: ["A confident but unsupported output", "A faster database", "A network cable", "A model checkpoint"],
          expectedAnswer: "A confident but unsupported output"
        },
        {
          id: "q-ai-3",
          type: "TEXT",
          prompt: "Why should teams evaluate model outputs?",
          expectedAnswer: "Evaluation checks whether outputs are accurate, useful, and safe for the intended context."
        },
        {
          id: "q-ai-4",
          type: "TEXT",
          prompt: "Give one responsible AI consideration.",
          expectedAnswer: "Teams should consider privacy, fairness, transparency, and human oversight when using AI."
        }
      ]
    }
  }
];
