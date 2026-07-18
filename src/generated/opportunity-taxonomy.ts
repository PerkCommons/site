const taxonomy = {
  "$schema": "./opportunity-taxonomy.schema.json",
  "version": 1,
  "categories": [
    {
      "id": "startup-benefits",
      "label": "Startup Benefits",
      "description": "Credits, discounts, and operational support designed for startups and founders.",
      "subcategories": [
        {
          "id": "cloud-credits",
          "label": "Cloud credits"
        },
        {
          "id": "infrastructure-credits",
          "label": "Infrastructure credits"
        },
        {
          "id": "saas-discounts",
          "label": "SaaS discounts"
        },
        {
          "id": "incorporation-support",
          "label": "Incorporation support"
        },
        {
          "id": "legal-support",
          "label": "Legal support"
        },
        {
          "id": "accounting-support",
          "label": "Accounting support"
        },
        {
          "id": "banking-finance",
          "label": "Banking and finance"
        },
        {
          "id": "marketing-tools",
          "label": "Marketing tools"
        },
        {
          "id": "customer-support-tools",
          "label": "Customer support tools"
        },
        {
          "id": "analytics-observability",
          "label": "Analytics and observability"
        },
        {
          "id": "security-tools",
          "label": "Security tools"
        },
        {
          "id": "developer-tooling",
          "label": "Developer tooling"
        }
      ]
    },
    {
      "id": "student-benefits",
      "label": "Student Benefits",
      "description": "Products, learning resources, and memberships offered specifically to students.",
      "subcategories": [
        {
          "id": "software-discounts",
          "label": "Software discounts"
        },
        {
          "id": "education-plans",
          "label": "Education plans"
        },
        {
          "id": "student-developer-packs",
          "label": "Student developer packs"
        },
        {
          "id": "free-courses",
          "label": "Free courses"
        },
        {
          "id": "certification-discounts",
          "label": "Certification discounts"
        },
        {
          "id": "hardware-discounts",
          "label": "Hardware discounts"
        },
        {
          "id": "student-memberships",
          "label": "Student memberships"
        },
        {
          "id": "academic-resources",
          "label": "Academic resources"
        }
      ]
    },
    {
      "id": "nonprofit-benefits",
      "label": "Nonprofit Benefits",
      "description": "Donations, discounts, tools, and advisory support for eligible nonprofit organizations.",
      "subcategories": [
        {
          "id": "software-donations",
          "label": "Software donations"
        },
        {
          "id": "nonprofit-discounts",
          "label": "Nonprofit discounts"
        },
        {
          "id": "cloud-credits",
          "label": "Cloud credits"
        },
        {
          "id": "fundraising-tools",
          "label": "Fundraising tools"
        },
        {
          "id": "communications-tools",
          "label": "Communications tools"
        },
        {
          "id": "productivity-tools",
          "label": "Productivity tools"
        },
        {
          "id": "security-tools",
          "label": "Security tools"
        },
        {
          "id": "nonprofit-consulting",
          "label": "Nonprofit consulting"
        }
      ]
    },
    {
      "id": "developer-programs",
      "label": "Developer Programs",
      "description": "Programs that give developers access, support, funding, or ways to represent a platform.",
      "subcategories": [
        {
          "id": "api-credits",
          "label": "API credits"
        },
        {
          "id": "open-source-programs",
          "label": "Open-source programs"
        },
        {
          "id": "developer-preview-programs",
          "label": "Developer preview programs"
        },
        {
          "id": "beta-access",
          "label": "Beta access"
        },
        {
          "id": "maintainer-support",
          "label": "Maintainer support"
        },
        {
          "id": "developer-grants",
          "label": "Developer grants"
        },
        {
          "id": "bug-bounty-programs",
          "label": "Bug bounty programs"
        },
        {
          "id": "ambassador-programs",
          "label": "Ambassador programs"
        }
      ]
    },
    {
      "id": "funding",
      "label": "Funding",
      "description": "Direct financial support, prizes, and sponsorship for people, research, communities, or projects.",
      "subcategories": [
        {
          "id": "grants",
          "label": "Grants"
        },
        {
          "id": "microgrants",
          "label": "Microgrants"
        },
        {
          "id": "prizes",
          "label": "Prizes"
        },
        {
          "id": "funded-fellowships",
          "label": "Fellowships with funding"
        },
        {
          "id": "research-funding",
          "label": "Research funding"
        },
        {
          "id": "creator-funds",
          "label": "Creator funds"
        },
        {
          "id": "community-funds",
          "label": "Community funds"
        },
        {
          "id": "open-source-sponsorships",
          "label": "Open-source sponsorships"
        }
      ]
    },
    {
      "id": "accelerators-incubators",
      "label": "Accelerators and Incubators",
      "description": "Structured programs that help teams develop ideas, organizations, or ventures.",
      "subcategories": [
        {
          "id": "startup-accelerators",
          "label": "Startup accelerators"
        },
        {
          "id": "nonprofit-accelerators",
          "label": "Nonprofit accelerators"
        },
        {
          "id": "student-incubators",
          "label": "Student incubators"
        },
        {
          "id": "university-incubators",
          "label": "University incubators"
        },
        {
          "id": "climate-accelerators",
          "label": "Climate accelerators"
        },
        {
          "id": "social-impact-accelerators",
          "label": "Social-impact accelerators"
        },
        {
          "id": "ai-accelerators",
          "label": "AI accelerators"
        },
        {
          "id": "pre-accelerators",
          "label": "Pre-accelerators"
        }
      ]
    },
    {
      "id": "competitions-hackathons",
      "label": "Competitions and Hackathons",
      "description": "Time-bound challenges where participants build, pitch, design, analyze, or compete.",
      "subcategories": [
        {
          "id": "online-hackathons",
          "label": "Online hackathons"
        },
        {
          "id": "in-person-hackathons",
          "label": "In-person hackathons"
        },
        {
          "id": "startup-competitions",
          "label": "Startup competitions"
        },
        {
          "id": "pitch-competitions",
          "label": "Pitch competitions"
        },
        {
          "id": "innovation-challenges",
          "label": "Innovation challenges"
        },
        {
          "id": "data-science-competitions",
          "label": "Data science competitions"
        },
        {
          "id": "design-competitions",
          "label": "Design competitions"
        },
        {
          "id": "student-competitions",
          "label": "Student competitions"
        }
      ]
    },
    {
      "id": "fellowships",
      "label": "Fellowships",
      "description": "Cohort-based opportunities for focused learning, research, service, or professional development.",
      "subcategories": [
        {
          "id": "technical-fellowships",
          "label": "Technical fellowships"
        },
        {
          "id": "research-fellowships",
          "label": "Research fellowships"
        },
        {
          "id": "policy-fellowships",
          "label": "Policy fellowships"
        },
        {
          "id": "entrepreneurship-fellowships",
          "label": "Entrepreneurship fellowships"
        },
        {
          "id": "social-impact-fellowships",
          "label": "Social-impact fellowships"
        },
        {
          "id": "creator-fellowships",
          "label": "Creator fellowships"
        },
        {
          "id": "student-fellowships",
          "label": "Student fellowships"
        },
        {
          "id": "open-source-fellowships",
          "label": "Open-source fellowships"
        }
      ]
    },
    {
      "id": "internships-work-experience",
      "label": "Internships and Work Experience",
      "description": "Short- or medium-term opportunities to gain practical professional experience.",
      "subcategories": [
        {
          "id": "internships",
          "label": "Internships"
        },
        {
          "id": "apprenticeships",
          "label": "Apprenticeships"
        },
        {
          "id": "externships",
          "label": "Externships"
        },
        {
          "id": "residencies",
          "label": "Residencies"
        },
        {
          "id": "traineeships",
          "label": "Traineeships"
        },
        {
          "id": "job-shadowing-programs",
          "label": "Job-shadowing programs"
        },
        {
          "id": "returnships",
          "label": "Returnships"
        },
        {
          "id": "project-based-experience",
          "label": "Project-based experience"
        }
      ]
    },
    {
      "id": "research-opportunities",
      "label": "Research Opportunities",
      "description": "Programs, resources, and access that enable academic or independent research.",
      "subcategories": [
        {
          "id": "research-internships",
          "label": "Research internships"
        },
        {
          "id": "research-assistantships",
          "label": "Research assistantships"
        },
        {
          "id": "lab-programs",
          "label": "Lab programs"
        },
        {
          "id": "visiting-researcher-programs",
          "label": "Visiting researcher programs"
        },
        {
          "id": "dataset-access",
          "label": "Dataset access"
        },
        {
          "id": "compute-credits",
          "label": "Compute credits"
        },
        {
          "id": "academic-challenges",
          "label": "Academic challenges"
        },
        {
          "id": "publication-support",
          "label": "Publication support"
        }
      ]
    },
    {
      "id": "mentorship-community",
      "label": "Mentorship and Community",
      "description": "Relationships and communities that provide guidance, peer support, and expert access.",
      "subcategories": [
        {
          "id": "mentorship-programs",
          "label": "Mentorship programs"
        },
        {
          "id": "peer-communities",
          "label": "Peer communities"
        },
        {
          "id": "founder-communities",
          "label": "Founder communities"
        },
        {
          "id": "student-communities",
          "label": "Student communities"
        },
        {
          "id": "technical-communities",
          "label": "Technical communities"
        },
        {
          "id": "office-hours",
          "label": "Office hours"
        },
        {
          "id": "expert-networks",
          "label": "Expert networks"
        },
        {
          "id": "accountability-groups",
          "label": "Accountability groups"
        }
      ]
    },
    {
      "id": "education-training",
      "label": "Education and Training",
      "description": "Structured learning opportunities and financial support for gaining knowledge or credentials.",
      "subcategories": [
        {
          "id": "courses",
          "label": "Courses"
        },
        {
          "id": "bootcamps",
          "label": "Bootcamps"
        },
        {
          "id": "workshops",
          "label": "Workshops"
        },
        {
          "id": "certifications",
          "label": "Certifications"
        },
        {
          "id": "learning-paths",
          "label": "Learning paths"
        },
        {
          "id": "scholarships",
          "label": "Scholarships"
        },
        {
          "id": "tuition-support",
          "label": "Tuition support"
        },
        {
          "id": "exam-vouchers",
          "label": "Exam vouchers"
        }
      ]
    },
    {
      "id": "open-source",
      "label": "Open Source",
      "description": "Programs and resources that support open-source contributors, maintainers, and projects.",
      "subcategories": [
        {
          "id": "contributor-programs",
          "label": "Contributor programs"
        },
        {
          "id": "maintainer-programs",
          "label": "Maintainer programs"
        },
        {
          "id": "sponsorships",
          "label": "Sponsorships"
        },
        {
          "id": "issue-bounties",
          "label": "Issue bounties"
        },
        {
          "id": "mentorship-programs",
          "label": "Mentorship programs"
        },
        {
          "id": "project-grants",
          "label": "Project grants"
        },
        {
          "id": "fiscal-hosting",
          "label": "Fiscal hosting"
        },
        {
          "id": "infrastructure-support",
          "label": "Infrastructure support"
        }
      ]
    },
    {
      "id": "social-impact-civic-tech",
      "label": "Social Impact and Civic Tech",
      "description": "Opportunities that apply technology and community action to public-interest challenges.",
      "subcategories": [
        {
          "id": "civic-tech-programs",
          "label": "Civic-tech programs"
        },
        {
          "id": "humanitarian-programs",
          "label": "Humanitarian programs"
        },
        {
          "id": "public-interest-technology",
          "label": "Public-interest technology"
        },
        {
          "id": "climate-programs",
          "label": "Climate programs"
        },
        {
          "id": "accessibility-programs",
          "label": "Accessibility programs"
        },
        {
          "id": "education-impact-programs",
          "label": "Education-impact programs"
        },
        {
          "id": "health-impact-programs",
          "label": "Health-impact programs"
        },
        {
          "id": "community-development-programs",
          "label": "Community-development programs"
        }
      ]
    },
    {
      "id": "creator-media",
      "label": "Creator and Media Opportunities",
      "description": "Funding, fellowships, residencies, and support for creators and media professionals.",
      "subcategories": [
        {
          "id": "creator-funds",
          "label": "Creator funds"
        },
        {
          "id": "media-fellowships",
          "label": "Media fellowships"
        },
        {
          "id": "journalism-grants",
          "label": "Journalism grants"
        },
        {
          "id": "podcast-grants",
          "label": "Podcast grants"
        },
        {
          "id": "film-grants",
          "label": "Film grants"
        },
        {
          "id": "design-residencies",
          "label": "Design residencies"
        },
        {
          "id": "writing-programs",
          "label": "Writing programs"
        },
        {
          "id": "publishing-support",
          "label": "Publishing support"
        }
      ]
    },
    {
      "id": "events-conferences",
      "label": "Events and Conferences",
      "description": "Ways to attend, participate in, present at, or receive support for professional events.",
      "subcategories": [
        {
          "id": "conference-scholarships",
          "label": "Conference scholarships"
        },
        {
          "id": "travel-grants",
          "label": "Travel grants"
        },
        {
          "id": "speaker-opportunities",
          "label": "Speaker opportunities"
        },
        {
          "id": "community-tickets",
          "label": "Community tickets"
        },
        {
          "id": "student-tickets",
          "label": "Student tickets"
        },
        {
          "id": "startup-showcases",
          "label": "Startup showcases"
        },
        {
          "id": "demo-days",
          "label": "Demo days"
        },
        {
          "id": "networking-events",
          "label": "Networking events"
        }
      ]
    },
    {
      "id": "discounts-perks",
      "label": "Discounts and Perks",
      "description": "General-purpose discounts and benefits that do not fit a more specific audience category.",
      "subcategories": [
        {
          "id": "professional-software",
          "label": "Professional software"
        },
        {
          "id": "productivity-tools",
          "label": "Productivity tools"
        },
        {
          "id": "design-tools",
          "label": "Design tools"
        },
        {
          "id": "communications-tools",
          "label": "Communications tools"
        },
        {
          "id": "hosting",
          "label": "Hosting"
        },
        {
          "id": "hardware",
          "label": "Hardware"
        },
        {
          "id": "memberships",
          "label": "Memberships"
        },
        {
          "id": "travel-coworking",
          "label": "Travel and coworking"
        }
      ]
    },
    {
      "id": "volunteer-service",
      "label": "Volunteer and Service",
      "description": "Unpaid or pro bono opportunities to contribute skills, time, or mentorship to a cause.",
      "subcategories": [
        {
          "id": "skilled-volunteering",
          "label": "Skilled volunteering"
        },
        {
          "id": "nonprofit-projects",
          "label": "Nonprofit projects"
        },
        {
          "id": "civic-volunteering",
          "label": "Civic volunteering"
        },
        {
          "id": "open-source-volunteering",
          "label": "Open-source volunteering"
        },
        {
          "id": "mentorship-volunteering",
          "label": "Mentorship volunteering"
        },
        {
          "id": "community-service",
          "label": "Community service"
        },
        {
          "id": "pro-bono-work",
          "label": "Pro bono work"
        },
        {
          "id": "remote-volunteering",
          "label": "Remote volunteering"
        }
      ]
    },
    {
      "id": "awards-recognition",
      "label": "Awards and Recognition",
      "description": "Recognition programs that celebrate achievements by people, projects, or organizations.",
      "subcategories": [
        {
          "id": "innovation-awards",
          "label": "Innovation awards"
        },
        {
          "id": "student-awards",
          "label": "Student awards"
        },
        {
          "id": "open-source-awards",
          "label": "Open-source awards"
        },
        {
          "id": "community-awards",
          "label": "Community awards"
        },
        {
          "id": "research-awards",
          "label": "Research awards"
        },
        {
          "id": "social-impact-awards",
          "label": "Social-impact awards"
        },
        {
          "id": "creator-awards",
          "label": "Creator awards"
        },
        {
          "id": "founder-awards",
          "label": "Founder awards"
        }
      ]
    },
    {
      "id": "early-access",
      "label": "Early Access and Experimental Programs",
      "description": "Opportunities to try, evaluate, or help shape products and research before general release.",
      "subcategories": [
        {
          "id": "private-betas",
          "label": "Private betas"
        },
        {
          "id": "public-betas",
          "label": "Public betas"
        },
        {
          "id": "research-previews",
          "label": "Research previews"
        },
        {
          "id": "developer-previews",
          "label": "Developer previews"
        },
        {
          "id": "pilot-programs",
          "label": "Pilot programs"
        },
        {
          "id": "product-testing",
          "label": "Product testing"
        },
        {
          "id": "waitlists",
          "label": "Waitlists"
        },
        {
          "id": "early-adopter-programs",
          "label": "Early-adopter programs"
        }
      ]
    }
  ],
  "legacyCategoryAliases": {
    "ai-credits": "startup-benefits",
    "cloud-credits": "startup-benefits",
    "startup-programs": "startup-benefits",
    "grants": "funding",
    "discounts": "discounts-perks",
    "accelerators": "accelerators-incubators",
    "business-perks": "startup-benefits"
  }
} as const;

export default taxonomy;
