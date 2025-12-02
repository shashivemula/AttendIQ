// AI Leave Management Frontend - Phase 2
// Handles display and interaction with AI-powered leave analysis

class AILeaveManager {
    constructor() {
        this.apiBase = window.API_BASE_URL || 'http://localhost:5000';
    }

    // Display leave request with AI analysis
    displayLeaveRequest(request) {
        // Parse AI analysis if available
        let aiAnalysis = null;
        if (request.ai_recommendation) {
            try {
                aiAnalysis = JSON.parse(request.ai_recommendation);
            } catch (e) {
                console.warn('Failed to parse AI analysis:', e);
            }
        }

        return `
            <div class="leave-request-item status-${request.status}">
                <div class="request-header">
                    <div class="student-info">
                        <h4>${this.escapeHtml(request.student_name)}</h4>
                        <p>${this.escapeHtml(request.student_email)}</p>
                    </div>
                    <div class="header-badges">
                        ${aiAnalysis ? `
                            <div class="ai-score-badge risk-${aiAnalysis.riskLevel}">
                                🤖 AI Score: ${aiAnalysis.credibilityScore}/100
                            </div>
                        ` : ''}
                        <div class="status-badge ${request.status}">
                            ${request.status.toUpperCase()}
                        </div>
                    </div>
                </div>
                
                ${aiAnalysis ? this.renderAIAnalysis(aiAnalysis) : ''}
                
                <div class="request-details">
                    <div class="detail-row">
                        <strong>Subject:</strong> ${this.escapeHtml(request.subject)}
                    </div>
                    <div class="detail-row">
                        <strong>Leave Date:</strong> ${new Date(request.leave_date).toLocaleDateString()}
                    </div>
                    <div class="detail-row">
                        <strong>Category:</strong> ${this.escapeHtml(request.reason_category)}
                    </div>
                    <div class="detail-row">
                        <strong>Reason:</strong> ${this.escapeHtml(request.reason_text)}
                    </div>
                    ${request.faculty_comments ? `
                        <div class="detail-row">
                            <strong>Faculty Comments:</strong> ${this.escapeHtml(request.faculty_comments)}
                        </div>
                    ` : ''}
                    <div class="detail-row">
                        <strong>Submitted:</strong> ${new Date(request.created_at).toLocaleString()}
                    </div>
                </div>
                ${request.status === 'pending' ? `
                    <div class="request-actions">
                        <button class="btn btn-success" onclick="updateLeaveStatus(${request.id}, 'approved')">
                            <i class="fas fa-check"></i> Approve
                        </button>
                        <button class="btn btn-danger" onclick="updateLeaveStatus(${request.id}, 'rejected')">
                            <i class="fas fa-times"></i> Reject
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    }

    // Render AI analysis section
    renderAIAnalysis(aiAnalysis) {
        return `
            <div class="ai-analysis-section">
                <div class="ai-header">
                    <h5><i class="fas fa-robot"></i> AI Analysis</h5>
                    <span class="risk-indicator risk-${aiAnalysis.riskLevel}">
                        <i class="fas ${this.getRiskIcon(aiAnalysis.riskLevel)}"></i>
                        ${aiAnalysis.riskLevel.toUpperCase()} RISK
                    </span>
                </div>
                
                <div class="ai-insights">
                    <div class="insight-item">
                        <strong>Recommendation:</strong> 
                        <span class="recommendation-${aiAnalysis.recommendations[0]?.action}">
                            ${aiAnalysis.recommendations[0]?.action?.toUpperCase() || 'REVIEW'}
                        </span>
                        <small class="confidence-${aiAnalysis.recommendations[0]?.confidence}">
                            (${aiAnalysis.recommendations[0]?.confidence} confidence)
                        </small>
                    </div>
                    
                    ${aiAnalysis.flags && aiAnalysis.flags.length > 0 ? `
                        <div class="insight-item">
                            <strong>Flags:</strong>
                            <div class="flags-list">
                                ${aiAnalysis.flags.map(flag => `
                                    <span class="flag-item flag-${flag.type}">
                                        ${flag.icon} ${flag.message}
                                    </span>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                    
                    ${aiAnalysis.patterns && aiAnalysis.patterns.length > 0 ? `
                        <div class="insight-item">
                            <strong>Patterns Detected:</strong>
                            <div class="patterns-list">
                                ${aiAnalysis.patterns.map(pattern => `
                                    <span class="pattern-item severity-${pattern.severity}">
                                        ⚠️ ${pattern.description}
                                    </span>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                    
                    ${aiAnalysis.recommendations.length > 1 ? `
                        <div class="insight-item">
                            <strong>Additional Recommendations:</strong>
                            <ul style="margin: 0.25rem 0 0 1rem; font-size: 0.85rem;">
                                ${aiAnalysis.recommendations.slice(1).map(rec => `
                                    <li>${rec.reason}</li>
                                `).join('')}
                            </ul>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    // Get risk level icon
    getRiskIcon(riskLevel) {
        switch(riskLevel) {
            case 'low': return 'fa-check-circle';
            case 'medium': return 'fa-exclamation-triangle';
            case 'high': return 'fa-exclamation-circle';
            default: return 'fa-question-circle';
        }
    }

    // Escape HTML to prevent XSS
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Generate AI summary for faculty dashboard
    generateAISummary(requests) {
        if (!requests || requests.length === 0) {
            return {
                totalRequests: 0,
                highRiskCount: 0,
                averageScore: 0,
                recommendations: {
                    approve: 0,
                    reject: 0,
                    review: 0
                }
            };
        }

        let totalScore = 0;
        let scoredRequests = 0;
        let highRiskCount = 0;
        const recommendations = { approve: 0, reject: 0, review: 0 };

        requests.forEach(request => {
            if (request.ai_recommendation) {
                try {
                    const analysis = JSON.parse(request.ai_recommendation);
                    
                    if (analysis.credibilityScore !== undefined) {
                        totalScore += analysis.credibilityScore;
                        scoredRequests++;
                    }
                    
                    if (analysis.riskLevel === 'high') {
                        highRiskCount++;
                    }
                    
                    if (analysis.recommendations && analysis.recommendations[0]) {
                        const action = analysis.recommendations[0].action;
                        if (recommendations.hasOwnProperty(action)) {
                            recommendations[action]++;
                        }
                    }
                } catch (e) {
                    console.warn('Failed to parse AI analysis for summary:', e);
                }
            }
        });

        return {
            totalRequests: requests.length,
            highRiskCount,
            averageScore: scoredRequests > 0 ? Math.round(totalScore / scoredRequests) : 0,
            recommendations
        };
    }

    // Display AI summary in dashboard
    displayAISummary(summary) {
        return `
            <div class="ai-summary-card">
                <div class="ai-summary-header">
                    <h4><i class="fas fa-brain"></i> AI Analysis Summary</h4>
                </div>
                <div class="ai-summary-stats">
                    <div class="summary-stat">
                        <span class="stat-number">${summary.totalRequests}</span>
                        <span class="stat-label">Total Requests</span>
                    </div>
                    <div class="summary-stat ${summary.highRiskCount > 0 ? 'stat-warning' : ''}">
                        <span class="stat-number">${summary.highRiskCount}</span>
                        <span class="stat-label">High Risk</span>
                    </div>
                    <div class="summary-stat">
                        <span class="stat-number">${summary.averageScore}</span>
                        <span class="stat-label">Avg Score</span>
                    </div>
                </div>
                <div class="ai-recommendations-breakdown">
                    <div class="rec-item rec-approve">
                        <i class="fas fa-check"></i>
                        <span>Approve: ${summary.recommendations.approve}</span>
                    </div>
                    <div class="rec-item rec-review">
                        <i class="fas fa-eye"></i>
                        <span>Review: ${summary.recommendations.review}</span>
                    </div>
                    <div class="rec-item rec-reject">
                        <i class="fas fa-times"></i>
                        <span>Reject: ${summary.recommendations.reject}</span>
                    </div>
                </div>
            </div>
        `;
    }

    // Show AI insights modal
    showAIInsights(analysis) {
        const modal = document.createElement('div');
        modal.className = 'ai-insights-modal';
        modal.innerHTML = `
            <div class="modal-overlay" onclick="this.parentElement.remove()"></div>
            <div class="modal-content">
                <div class="modal-header">
                    <h3><i class="fas fa-robot"></i> Detailed AI Analysis</h3>
                    <button class="modal-close" onclick="this.closest('.ai-insights-modal').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    ${this.renderDetailedAnalysis(analysis)}
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }

    // Render detailed AI analysis
    renderDetailedAnalysis(analysis) {
        return `
            <div class="detailed-analysis">
                <div class="analysis-section">
                    <h4>Credibility Assessment</h4>
                    <div class="credibility-meter">
                        <div class="meter-bar">
                            <div class="meter-fill" style="width: ${analysis.credibilityScore}%"></div>
                        </div>
                        <span class="meter-score">${analysis.credibilityScore}/100</span>
                    </div>
                    <p class="risk-explanation">
                        This request has been classified as <strong>${analysis.riskLevel} risk</strong> 
                        based on pattern analysis and historical data.
                    </p>
                </div>
                
                ${analysis.patterns && analysis.patterns.length > 0 ? `
                    <div class="analysis-section">
                        <h4>Pattern Analysis</h4>
                        <div class="patterns-detailed">
                            ${analysis.patterns.map(pattern => `
                                <div class="pattern-detail severity-${pattern.severity}">
                                    <div class="pattern-header">
                                        <span class="pattern-type">${pattern.type.replace('_', ' ').toUpperCase()}</span>
                                        <span class="pattern-severity">${pattern.severity}</span>
                                    </div>
                                    <p class="pattern-description">${pattern.description}</p>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
                
                <div class="analysis-section">
                    <h4>AI Recommendations</h4>
                    <div class="recommendations-detailed">
                        ${analysis.recommendations.map(rec => `
                            <div class="recommendation-detail">
                                <div class="rec-action rec-${rec.action}">
                                    ${rec.action.toUpperCase()}
                                </div>
                                <div class="rec-content">
                                    <div class="rec-confidence">Confidence: ${rec.confidence}</div>
                                    <div class="rec-reason">${rec.reason}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }
}

// Initialize AI Leave Manager
window.aiLeaveManager = new AILeaveManager();

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AILeaveManager;
}